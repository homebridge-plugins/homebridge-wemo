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

    // Add the humidifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HumidifierDehumidifier)
    || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Add the set handler to the humidifier active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Add options to the humidifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
      .updateValue(1)
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [1],
      })

    // Add the set handler to the humidifier target relative humidity characteristic
    this.service
      .getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      .onSet(async (value) => {
        await this.internalTargetHumidityUpdate(value)
      })

    // Add the set handler to the humidifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 20 })
      .onSet(async (value) => {
        await this.internalModeUpdate(value)
      })

    // Add a last mode cache value if not already set
    const cacheMode = this.accessory.context.cacheLastOnMode
    if (!cacheMode || cacheMode === 0) {
      this.accessory.context.cacheLastOnMode = 1
    }

    // Some conversion objects
    this.modeLabels = {
      0: platformLang.labelOff,
      1: platformLang.labelMin,
      2: platformLang.labelLow,
      3: platformLang.labelMed,
      4: platformLang.labelHigh,
      5: platformLang.labelMax,
    }
    this.hToWemoFormat = {
      45: 0,
      50: 1,
      55: 2,
      60: 3,
      100: 4,
    }
    this.wemoFormatToH = {
      0: 45,
      1: 50,
      2: 55,
      3: 60,
      4: 100,
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
      case 'FanMode':
        this.externalModeUpdate(attribute.value)
        break
      case 'CurrentHumidity':
        this.externalCurrentHumidityUpdate(attribute.value)
        break
      case 'DesiredHumidity':
        this.externalTargetHumidityUpdate(attribute.value)
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
          case 'FanMode':
          case 'CurrentHumidity':
          case 'DesiredHumidity':
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

      // We also want to update the mode by rotation speed when turning on/off
      // Use the set handler to run the RotationSpeed set handler, to send updates to device
      this.service.setCharacteristic(
        this.hapChar.RotationSpeed,
        value === 0 ? 0 : this.accessory.context.cacheLastOnMode * 20,
      )
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

      // Find the new needed mode from the given rotation speed
      let newValue = 0
      if (value > 10 && value <= 30) {
        newValue = 1
      } else if (value > 30 && value <= 50) {
        newValue = 2
      } else if (value > 50 && value <= 70) {
        newValue = 3
      } else if (value > 70 && value <= 90) {
        newValue = 4
      } else if (value > 90) {
        newValue = 5
      }

      // Don't continue if the rotation speed is the same as before
      if (value === prevSpeed) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        FanMode: newValue.toString(),
      })

      // Update the last used mode cache if rotation speed is not 0
      if (newValue !== 0) {
        this.accessory.context.cacheLastOnMode = newValue
      }

      // Log the update if appropriate
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

  async internalTargetHumidityUpdate(value) {
    const prevHumi = this.service.getCharacteristic(
      this.hapChar.RelativeHumidityHumidifierThreshold,
    ).value
    try {
      // Avoid multiple updates in quick succession
      const updateKeyHumi = generateRandomString(5)
      this.updateKeyHumi = updateKeyHumi
      await sleep(500)
      if (updateKeyHumi !== this.updateKeyHumi) {
        return
      }

      // Find the new target humidity mode from the target humidity given
      let newValue = 45
      if (value >= 47 && value < 52) {
        newValue = 50
      } else if (value >= 52 && value < 57) {
        newValue = 55
      } else if (value >= 57 && value < 80) {
        newValue = 60
      } else if (value >= 80) {
        newValue = 100
      }

      // Don't continue if the new mode is the same as before
      if (newValue === prevHumi) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        DesiredHumidity: this.hToWemoFormat[newValue],
      })

      // Log the change if appropriate
      this.accessory.log(`${platformLang.tarHumi} [${newValue}%]`)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.RelativeHumidityHumidifierThreshold,
          prevHumi,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalModeUpdate(value) {
    try {
      // Find the needed rotation speed from the given mode
      const rotSpeed = value * 20

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Update the last used mode if not off
      if (value !== 0) {
        this.accessory.context.cacheLastOnMode = value
      }

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curMode} [${this.modeLabels[value]}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalTargetHumidityUpdate(value) {
    try {
      // Find the HomeKit value version from the given target humidity mode
      value = this.wemoFormatToH[value]

      // Don't continue if the new target is the same as the current target
      const t = this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
        .value
      if (t === value) {
        return
      }

      // Update the target humidity HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold, value)

      // Log the change if appropriate
      this.accessory.log(`${platformLang.tarHumi} [${value}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalCurrentHumidityUpdate(value) {
    try {
      // Don't continue if the new current humidity is the same as before
      if (this.service.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value === value) {
        return
      }

      // Update the current relative humidity HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, value)

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curHumi} [${value}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
