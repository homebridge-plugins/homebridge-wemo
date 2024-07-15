import { Builder, parseStringPromise } from 'xml2js'
import {
  decodeXML,
  generateRandomString,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
    || this.accessory.addService(this.hapServ.HeaterCooler)

    // Add the set handler to the heater active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Add options to the heater target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).setProps({
      minValue: 0,
      maxValue: 0,
      validValues: [0],
    })

    // Add the set handler and a range to the heater target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minStep: 1,
        minValue: 16,
        maxValue: 29,
      })
      .onSet(async (value) => {
        await this.internalTargetTempUpdate(value)
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 33 })
      .onSet(async (value) => {
        await this.internalModeUpdate(value)
      })

    // Add a last mode cache value if not already set
    const cacheMode = this.accessory.context.cacheLastOnMode
    if (!cacheMode || [0, 1].includes(cacheMode)) {
      this.accessory.context.cacheLastOnMode = 4
    }

    // Add a last temperature cache value if not already set
    if (!this.accessory.context.cacheLastOnTemp) {
      this.accessory.context.cacheLastOnTemp = 16
    }

    // Some conversion objects
    this.modeLabels = {
      0: platformLang.labelOff,
      1: platformLang.labelFP,
      2: platformLang.labelHigh,
      3: platformLang.labelLow,
      4: platformLang.labelEco,
    }
    this.cToF = {
      16: 61,
      17: 63,
      18: 64,
      19: 66,
      20: 68,
      21: 70,
      22: 72,
      23: 73,
      24: 75,
      25: 77,
      26: 79,
      27: 81,
      28: 83,
      29: 84,
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)

    // Request a device update immediately
    this.requestDeviceUpdate()

    // Start a polling interval if the user has disabled upnp
    if (this.accessory.context.connection === 'http') {
      this.pollingInterval = setInterval(
        () => this.requestDeviceUpdate(),
        platform.config.pollingInterval * 1000,
      )
    }
  }

  receiveDeviceUpdate(attribute) {
    // Log the receiving update if debug is enabled
    this.accessory.logDebug(`${platformLang.recUpd} [${attribute.name}: ${JSON.stringify(attribute.value)}]`)

    // Check which attribute we are getting
    switch (attribute.name) {
      case 'Mode':
        this.externalModeUpdate(attribute.value)
        break
      case 'Temperature':
        this.externalCurrentTempUpdate(attribute.value)
        break
      case 'SetTemperature':
        this.externalTargetTempUpdate(attribute.value)
        break
      default:
    }
  }

  async requestDeviceUpdate() {
    try {
      // Request the update
      const data = await this.platform.httpClient.sendDeviceUpdate(
        this.accessory,
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes',
      )

      // Parse the response
      const decoded = decodeXML(data.attributeList)
      const xml = `<attributeList>${decoded}</attributeList>`
      const result = await parseStringPromise(xml, { explicitArray: false })
      Object.keys(result.attributeList.attribute).forEach((key) => {
        // Only send the required attributes to the receiveDeviceUpdate function
        switch (result.attributeList.attribute[key].name) {
          case 'Mode':
          case 'Temperature':
          case 'SetTemperature':
            this.receiveDeviceUpdate({
              name: result.attributeList.attribute[key].name,
              value: Number.parseInt(result.attributeList.attribute[key].value, 10),
            })
            break
          default:
        }
      })
    } catch (err) {
      const eText = parseError(err, [
        platformLang.timeout,
        platformLang.timeoutUnreach,
        platformLang.noService,
      ])
      this.accessory.logDebugWarn(`${platformLang.rduErr} ${eText}`)
    }
  }

  async sendDeviceUpdate(attributes) {
    // Log the sending update if debug is enabled
    this.accessory.log(`${platformLang.senUpd} ${JSON.stringify(attributes)}`)

    // Generate the XML to send
    const builder = new Builder({
      rootName: 'attribute',
      headless: true,
      renderOpts: { pretty: false },
    })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({
        name: attributeKey,
        value: attributes[attributeKey],
      }))
      .join('')

    // Send the update
    await this.platform.httpClient.sendDeviceUpdate(
      this.accessory,
      'urn:Belkin:service:deviceevent:1',
      'SetAttributes',
      {
        attributeList: { '#text': xmlAttributes },
      },
    )
  }

  async internalStateUpdate(value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
      // Don't continue if the state is the same as before
      if (value === prevState) {
        return
      }

      // We also want to update the mode (by rotation speed)
      let newRotSpeed = 0
      if (value !== 0) {
        // If turning on then we want to show the last used mode (by rotation speed)
        switch (this.accessory.context.cacheLastOnMode) {
          case 2:
            newRotSpeed = 99
            break
          case 3:
            newRotSpeed = 66
            break
          default:
            newRotSpeed = 33
        }
      }

      // Update the rotation speed, use setCharacteristic so the set handler is run to send updates
      this.service.setCharacteristic(this.hapChar.RotationSpeed, newRotSpeed)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalModeUpdate(value) {
    const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    try {
      // Avoid multiple updates in quick succession
      const updateKeyMode = generateRandomString(5)
      this.updateKeyMode = updateKeyMode
      await sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }

      // Generate newValue for the needed mode and newSpeed in 33% multiples
      let newValue = 1
      let newSpeed = 0
      if (value > 25 && value <= 50) {
        newValue = 4
        newSpeed = 33
      } else if (value > 50 && value <= 75) {
        newValue = 3
        newSpeed = 66
      } else if (value > 75) {
        newValue = 2
        newSpeed = 99
      }

      // Don't continue if the speed is the same as before
      if (newSpeed === prevSpeed) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        Mode: newValue,
        SetTemperature: this.cToF[Number.parseInt(this.accessory.context.cacheLastOnTemp, 10)],
      })

      // Update the cache last used mode if not turning off
      if (newValue !== 1) {
        this.accessory.context.cacheLastOnMode = newValue
      }

      // Log the new mode if appropriate
      this.accessory.log(`${platformLang.curMode} [${this.modeLabels[newValue]}]`)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, prevSpeed)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetTempUpdate(value) {
    const prevTemp = this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
    try {
      // Avoid multiple updates in quick succession
      const updateKeyTemp = generateRandomString(5)
      this.updateKeyTemp = updateKeyTemp
      await sleep(500)
      if (updateKeyTemp !== this.updateKeyTemp) {
        return
      }

      // We want an integer target temp value and to not continue if this is the same as before
      value = Number.parseInt(value, 10)
      if (value === prevTemp) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({ SetTemperature: this.cToF[value] })

      // Update the cache and log if appropriate
      this.accessory.context.cacheLastOnTemp = value
      this.accessory.log(`${platformLang.tarTemp} [${value}°C]`)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, prevTemp)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalModeUpdate(value) {
    try {
      // We want to find a rotation speed based on the given mode
      let rotSpeed = 0
      switch (value) {
        case 2: {
          rotSpeed = 99
          break
        }
        case 3: {
          rotSpeed = 66
          break
        }
        case 4: {
          rotSpeed = 33
          break
        }
        default:
          return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 1 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Update the last used mode if the device is not off
      if (value !== 1) {
        this.accessory.context.cacheLastOnMode = value
      }

      // Log the change of mode if appropriate
      this.accessory.log(`${platformLang.curMode} [${this.modeLabels[value]}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalTargetTempUpdate(value) {
    try {
      // Don't continue if receiving frost-protect temperature (°C or °F)
      if (value === 4 || value === 40) {
        return
      }

      // A value greater than 50 normally means °F, so convert to °C
      if (value > 50) {
        value = Math.round(((value - 32) * 5) / 9)
      }

      // Make sure the value is in the [16, 29] range
      value = Math.max(Math.min(value, 29), 16)

      // Check if the new target temperature is different from the current target temperature
      if (
        this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value !== value
      ) {
        // Update the target temperature HomeKit characteristic
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, value)

        // Log the change if appropriate
        this.accessory.log(`${platformLang.tarTemp} [${value}°C]`)
      }

      // Update the last-ON-target-temp cache
      this.accessory.context.cacheLastOnTemp = value
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalCurrentTempUpdate(value) {
    try {
      // A value greater than 50 normally means °F, so convert to °C
      if (value > 50) {
        value = Math.round(((value - 32) * 5) / 9)
      }

      // Don't continue if new current temperature is the same as before
      if (this.cacheTemp === value) {
        return
      }

      // Update the current temperature HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.CurrentTemperature, value)

      // Update the cache and log the change if appropriate
      this.cacheTemp = value
      this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
