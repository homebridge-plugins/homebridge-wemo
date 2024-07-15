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

    // Add the purifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.AirPurifier)
    || this.accessory.addService(this.hapServ.AirPurifier)

    // Add the air quality service if it doesn't already exist
    this.airService = this.accessory.getService(this.hapServ.AirQualitySensor)
    || this.accessory.addService(this.hapServ.AirQualitySensor, 'Air Quality', 'airquality')

    // Add the (ionizer) switch service if it doesn't already exist
    this.ioService = this.accessory.getService(this.hapServ.Switch)
    || this.accessory.addService(this.hapServ.Switch, 'Ionizer', 'ionizer')

    // Add the set handler to the purifier active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Add options to the purifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetAirPurifierState)
      .updateValue(1)
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [1],
      })

    // Add the set handler to the purifier rotation speed (for mode) characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 25 })
      .onSet(async (value) => {
        await this.internalModeUpdate(value)
      })

    // Add the FilterChangeIndication characteristic to the air purifier if it isn't already
    if (!this.service.testCharacteristic(this.hapChar.FilterChangeIndication)) {
      this.service.addCharacteristic(this.hapChar.FilterChangeIndication)
    }
    this.cacheFilterX = this.service.getCharacteristic(this.hapChar.FilterChangeIndication).value

    // Add the FilterLifeLevel characteristic to the air purifier if it isn't already
    if (!this.service.testCharacteristic(this.hapChar.FilterLifeLevel)) {
      this.service.addCharacteristic(this.hapChar.FilterLifeLevel)
    }
    this.cacheFilter = this.service.getCharacteristic(this.hapChar.FilterLifeLevel).value

    // Add the set handler to the switch (for ionizer) characteristic
    this.ioService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalIonizerUpdate(value)
    })

    // Add a last mode cache value if not already set
    if (![1, 2, 3, 4].includes(this.accessory.context.cacheLastOnMode)) {
      this.accessory.context.cacheLastOnMode = 1
    }

    // Add an ionizer on/off cache value if not already set
    if (![0, 1].includes(this.accessory.context.cacheIonizerOn)) {
      this.accessory.context.cacheIonizerOn = 0
    }

    // Some conversion objects
    this.aqW2HK = {
      0: 5, // poor -> poor
      1: 3, // moderate -> fair
      2: 1, // good -> excellent
    }
    this.aqLabels = {
      5: platformLang.labelPoor,
      3: platformLang.labelFair,
      1: platformLang.labelExc,
    }
    this.modeLabels = {
      0: platformLang.labelOff,
      1: platformLang.labelLow,
      2: platformLang.labelMed,
      3: platformLang.labelHigh,
      4: platformLang.labelAuto,
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
      case 'AirQuality':
        this.externalAirQualityUpdate(attribute.value)
        break
      case 'ExpiredFilterTime':
        this.externalFilterChangeUpdate(attribute.value !== 0 ? 1 : 0)
        break
      case 'FilterLife':
        this.externalFilterLifeUpdate(Math.round((attribute.value / 60480) * 100))
        break
      case 'Ionizer':
        this.externalIonizerUpdate(attribute.value)
        break
      case 'Mode':
        this.externalModeUpdate(attribute.value)
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
          case 'AirQuality':
          case 'ExpiredFilterTime':
          case 'FilterLife':
          case 'Ionizer':
          case 'Mode':
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
      let newSpeed = 0
      if (value !== 0) {
        // If turning on then we want to show the last used mode (by rotation speed)
        switch (this.accessory.context.cacheLastOnMode) {
          case 2:
            newSpeed = 50
            break
          case 3:
            newSpeed = 75
            break
          case 4:
            newSpeed = 100
            break
          default:
            newSpeed = 25
        }
      }

      // Update the rotation speed, use setCharacteristic so the set handler is run to send updates
      this.service.setCharacteristic(this.hapChar.RotationSpeed, newSpeed)

      // Update the characteristic if we are now ON ie purifying air
      this.service.updateCharacteristic(
        this.hapChar.CurrentAirPurifierState,
        newSpeed === 0 ? 0 : 2,
      )

      // Update the ionizer characteristic if the purifier is on and the ionizer was on before
      this.ioService.updateCharacteristic(
        this.hapChar.On,
        value === 1 && this.accessory.context.cacheIonizerOn === 1,
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
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }

      // Don't continue if the speed is the same as before
      if (value === prevSpeed) {
        return
      }

      // Generate newValue for the needed mode depending on the new rotation speed value
      let newValue = 0
      if (value > 10 && value <= 35) {
        newValue = 1
      } else if (value > 35 && value <= 60) {
        newValue = 2
      } else if (value > 60 && value <= 85) {
        newValue = 3
      } else if (value > 85) {
        newValue = 4
      }

      // Send the update
      await this.sendDeviceUpdate({
        Mode: newValue.toString(),
      })

      // Update the cache last used mode if not turning off
      if (newValue !== 0) {
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

  async internalIonizerUpdate(value) {
    const prevState = this.ioService.getCharacteristic(this.hapChar.On).value
    try {
      // If turning on, but the purifier device is off, then turn the ionizer back off
      if (value && this.service.getCharacteristic(this.hapChar.Active).value === 0) {
        await sleep(1000)
        this.ioService.updateCharacteristic(this.hapChar.On, false)
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        Ionizer: value ? 1 : 0,
      })

      // Update the cache state of the ionizer
      this.accessory.context.cacheIonizerOn = value ? 1 : 0

      // Log the update if appropriate
      this.accessory.log(`${platformLang.curIon} [${value ? 'on' : 'off'}}]`)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.ioService.updateCharacteristic(this.hapChar.On, prevState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalModeUpdate(value) {
    try {
      // We want to find a rotation speed based on the given mode
      let rotSpeed = 0
      switch (value) {
        case 1: {
          rotSpeed = 25
          break
        }
        case 2: {
          rotSpeed = 50
          break
        }
        case 3: {
          rotSpeed = 75
          break
        }
        case 4: {
          rotSpeed = 100
          break
        }
        default:
          return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Turn the ionizer on or off based on whether the purifier is on or off
      if (value === 0) {
        this.ioService.updateCharacteristic(this.hapChar.On, false)
      } else {
        this.ioService.updateCharacteristic(
          this.hapChar.On,
          this.accessory.context.cacheIonizerOn === 1,
        )
        this.accessory.context.cacheLastOnMode = value
      }

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curMode} [${this.modeLabels[value]}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalAirQualityUpdate(value) {
    try {
      const newValue = this.aqW2HK[value]
      // Don't continue if the value is the same as before
      if (this.airService.getCharacteristic(this.hapChar.AirQuality).value === newValue) {
        return
      }

      // Update the HomeKit characteristics
      this.airService.updateCharacteristic(this.hapChar.AirQuality, newValue)

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curAir} [${this.aqLabels[newValue]}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalIonizerUpdate(value) {
    try {
      // Don't continue if the value is the same as before
      const state = this.ioService.getCharacteristic(this.hapChar.On).value ? 1 : 0
      if (state === value) {
        return
      }

      // Update the HomeKit characteristics
      this.ioService.updateCharacteristic(this.hapChar.On, value === 1)

      // Update the cache value and log the change if appropriate
      this.accessory.context.cacheIonizerOn = value
      this.accessory.log(`${platformLang.curIon} [${value === 1 ? 'on' : 'off'}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalFilterChangeUpdate(value) {
    try {
      // Don't continue if the value is the same as before
      if (value === this.cacheFilterX) {
        return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.FilterChangeIndication, value)

      // Update the cache value and log the change if appropriate
      this.cacheFilterX = value
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalFilterLifeUpdate(value) {
    try {
      // Don't continue if the value is the same as before
      if (value === this.cacheFilter) {
        return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.FilterLifeLevel, value)

      // Update the cache value and log the change if appropriate
      this.cacheFilter = value
      this.accessory.log(`${platformLang.curFilter} [${value}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
