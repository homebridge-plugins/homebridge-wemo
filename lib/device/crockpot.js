import {
  generateRandomString,
  hasProperty,
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
        minValue: 0,
        maxValue: 24,
        minStep: 0.5,
      })
      .onSet(async (value) => {
        await this.internalCookingTimeUpdate(value)
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 33 })
      .onSet(async (value) => {
        await this.internalModeUpdate(value)
      })

    // Add a range to the heater current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minValue: 0,
      maxValue: 24,
      minStep: 0.5,
    })

    // Some conversion objects
    this.modeLabels = {
      0: platformLang.labelOff,
      50: platformLang.labelWarm,
      51: platformLang.labelLow,
      52: platformLang.labelHigh,
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

  async requestDeviceUpdate() {
    try {
      // Request the update
      const data = await this.platform.httpClient.sendDeviceUpdate(
        this.accessory,
        'urn:Belkin:service:basicevent:1',
        'GetCrockpotState',
      )

      // Check for existence since data.mode can be 0
      if (hasProperty(data, 'mode')) {
        // Log the receiving update if debug is enabled
        this.accessory.logDebug(`${platformLang.recUpd} [mode: ${data.mode}]`)

        // Send the data to the receiver function
        this.externalModeUpdate(Number.parseInt(data.mode, 10))
      }

      // data.time can be 0 so check for existence
      if (hasProperty(data, 'time')) {
        // Log the receiving update if debug is enabled
        this.accessory.logDebug(`${platformLang.recUpd} [time: ${data.time}]`)

        // Send the data to the receiver function
        this.externalTimeLeftUpdate(Number.parseInt(data.time, 10))
      }
    } catch (err) {
      const eText = parseError(err, [
        platformLang.timeout,
        platformLang.timeoutUnreach,
        platformLang.noService,
      ])
      this.accessory.logDebugWarn(`${platformLang.rduErr} ${eText}`)
    }
  }

  receiveDeviceUpdate(attribute) {
    // Log the receiving update if debug is enabled
    this.accessory.logDebug(`${platformLang.recUpd} [${attribute.name}: ${JSON.stringify(attribute.value)}]`)

    // Send a HomeKit needed true/false argument
    // attribute.value is 0 if and only if the outlet is off
    // this.externalStateUpdate(attribute.value !== 0)
  }

  async sendDeviceUpdate(mode, time) {
    // Log the sending update if debug is enabled
    this.accessory.logDebug(`${platformLang.senUpd} {"mode": ${mode}, "time": ${time}`)

    // Send the update
    await this.platform.httpClient.sendDeviceUpdate(
      this.accessory,
      'urn:Belkin:service:basicevent:1',
      'SetCrockpotState',
      {
        mode: { '#text': mode },
        time: { '#text': time },
      },
    )
  }

  async internalStateUpdate(value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
      // Don't continue if the new value is the same as before
      if (value === prevState) {
        return
      }

      // A slight pause seems to make Home app more responsive for characteristic updates later
      await sleep(500)

      // Note value === 0 is OFF, value === 1 is ON
      if (value === 0) {
        // Turn everything off
        this.service.setCharacteristic(this.hapChar.RotationSpeed, 0)
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
      } else {
        // Set rotation speed to the lowest ON value
        this.service.setCharacteristic(this.hapChar.RotationSpeed, 33)
      }
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
      let newValue = 0
      let newSpeed = 0
      if (value > 25 && value <= 50) {
        newValue = 50
        newSpeed = 33
      } else if (value > 50 && value <= 75) {
        newValue = 51
        newSpeed = 66
      } else if (value > 75) {
        newValue = 52
        newSpeed = 99
      }

      // Don't continue if the speed is the same as before
      if (prevSpeed === newSpeed) {
        return
      }

      // A slight pause seems to make Home app more responsive for characteristic updates later
      await sleep(500)
      if ([0, 33].includes(newSpeed)) {
        // Reset the cooking times to 0 if turned off or set to warm
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0

        // Log the change if appropriate
        this.accessory.log(`${platformLang.curTimer} [0:00]`)
      }

      // Send the update
      await this.sendDeviceUpdate(newValue, this.accessory.context.cacheTime)

      // Update the cache and log if appropriate
      this.cacheMode = newValue
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

  async internalCookingTimeUpdate(value) {
    const prevTemp = this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
    try {
      // Avoid multiple updates in quick succession
      const updateKeyTemp = generateRandomString(5)
      this.updateKeyTemp = updateKeyTemp
      await sleep(500)
      if (updateKeyTemp !== this.updateKeyTemp) {
        return
      }

      // The value is cooking hours, I don't think device can be set to cook for 24 hours as max
      if (value === 24) {
        value = 23.5
      }

      // Don't continue if the value is the same as before
      if (value === prevTemp) {
        return
      }

      // Find the needed mode based on the new value
      const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      let modeChange = this.cacheMode
      // If cooking time is changed to above zero and mode is OFF or WARM, then set to LOW
      if (value !== 0 && [0, 33].includes(prevSpeed)) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 66)
        modeChange = 51
        this.cacheMode = 51

        // Log the mode change if appropriate
        this.accessory.log(`${platformLang.curMode} [${this.modeLabels[51]}]`)
      }

      // Send the update
      const minutes = value * 60
      await this.sendDeviceUpdate(modeChange, minutes)

      // Log the change of cooking minutes if appropriate
      const modMinutes = minutes % 60
      this.accessory.log(`${platformLang.curTimer} [${Math.floor(value)}:${modMinutes >= 10 ? modMinutes : `0${modMinutes}`}]`)
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
      // Don't continue if the given mode is the same as before
      if (value === this.cacheMode) {
        return
      }

      // Find the needed rotation speed based on the given mode
      let rotSpeed = 0
      switch (value) {
        case 0:
          break
        case 50: {
          rotSpeed = 33
          break
        }
        case 51: {
          rotSpeed = 66
          break
        }
        case 52: {
          rotSpeed = 99
          break
        }
        default:
          throw new Error(`Unknown value passed [${value} ${typeof value}]`)
      }
      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Update the cache and log if appropriate
      this.cacheMode = value
      this.accessory.log(`${platformLang.curMode} [${this.modeLabels[value]}]`)

      // If turned off then set the cooking time characteristics to 0
      if (value === 0) {
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalTimeLeftUpdate(value) {
    try {
      // Don't continue if the rounded cooking time is the same as before
      if (value === this.accessory.context.cacheTime) {
        return
      }

      // The value is passed in minutes (cooking time remaining)
      let hkValue = 0
      if (value > 0) {
        /*
          (1) convert to half-hour units (e.g. 159 -> 5.3)
          (2) round to nearest 0.5 hour unit (e.g. 5.3 -> 5)
          (3) if 0 then raise to 0.5 (as technically still cooking even if 1 minute)
        */
        hkValue = Math.max(Math.round(value / 30) / 2, 0.5)
      }

      const rotSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

      // Change to LOW mode if cooking but cache is OFF
      if (hkValue > 0 && rotSpeed === 0) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 33)
        this.cacheMode = 50
      }

      // Update the cooking time HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.CurrentTemperature, hkValue)
      this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, hkValue)

      // Update the cache and log if appropriate
      this.accessory.context.cacheTime = value
      const modMinutes = value % 60
      this.accessory.log(`${platformLang.curTimer} [${Math.floor(value / 60)}:${modMinutes >= 10 ? modMinutes : `0${modMinutes}`}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
