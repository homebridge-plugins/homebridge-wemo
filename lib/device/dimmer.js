import platformConsts from '../utils/constants.js'
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

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.serialNumber] || {}
    this.brightStep = deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platformConsts.defaultValues.brightnessStep

    // Add the lightbulb service if it doesn't already exist
    this.service = accessory.getService(this.hapServ.Lightbulb) || accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightStep })
      .onSet(async (value) => {
        await this.internalBrightnessUpdate(value)
      })

    // Output the customised options to the log
    const opts = JSON.stringify({
      brightnessStep: this.brightStep,
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
      case 'BinaryState': {
        // Send a HomeKit needed true/false argument
        // attribute.value is 0 if and only if the device is off
        const hkValue = attribute.value !== 0
        this.externalSwitchUpdate(hkValue)
        break
      }
      case 'Brightness':
        // Send a HomeKit needed INT argument
        this.externalBrightnessUpdate(attribute.value)
        break
      default:
    }
  }

  async sendDeviceUpdate(value) {
    // Log the sending update if debug is enabled
    this.accessory.logDebug(`${platformLang.senUpd} ${JSON.stringify(value)}`)

    // Send the update
    await this.platform.httpClient.sendDeviceUpdate(
      this.accessory,
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value,
    )
  }

  async requestDeviceUpdate() {
    try {
      // Request the update
      const data = await this.platform.httpClient.sendDeviceUpdate(
        this.accessory,
        'urn:Belkin:service:basicevent:1',
        'GetBinaryState',
      )

      // Check for existence since BinaryState can be int 0
      if (hasProperty(data, 'BinaryState')) {
        this.receiveDeviceUpdate({
          name: 'BinaryState',
          value: Number.parseInt(data.BinaryState, 10),
        })
      }

      // Check for existence since brightness can be int 0
      if (hasProperty(data, 'brightness')) {
        this.receiveDeviceUpdate({
          name: 'Brightness',
          value: Number.parseInt(data.brightness, 10),
        })
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

  async getCurrentBrightness() {
    // A quick function to get the current brightness of the device
    const data = await this.platform.httpClient.sendDeviceUpdate(
      this.accessory,
      'urn:Belkin:service:basicevent:1',
      'GetBinaryState',
    )
    return Number.parseInt(data.brightness, 10)
  }

  async internalStateUpdate(value) {
    try {
      // Wait a longer time than the brightness so in scenes brightness is sent first
      await sleep(500)

      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0,
      })

      // Update the cache and log if appropriate
      this.cacheState = value
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)

      // Don't continue if turning the device off
      if (!value) {
        return
      }

      // Wrap the extra brightness request in another try, so it doesn't affect the on/off change
      try {
        // When turning the device on we want to update the HomeKit brightness
        const updatedBrightness = await this.getCurrentBrightness()

        // Don't continue if the brightness is the same
        if (updatedBrightness === this.cacheBright) {
          return
        }

        // Update the brightness characteristic
        this.service.updateCharacteristic(this.hapChar.Brightness, updatedBrightness)

        // Update the cache and log if appropriate
        this.cacheBright = updatedBrightness
        this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
      } catch (err) {
        this.accessory.logWarn(`${platformLang.brightnessFail} ${parseError(err)}`)
      }
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // Avoid multiple updates in quick succession
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(300)
      if (updateKey !== this.updateKey) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value === 0 ? 0 : 1,
        brightness: value,
      })

      // Update the cache and log if appropriate
      this.cacheBright = value
      this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalSwitchUpdate(value) {
    try {
      // Don't continue if the value is the same as the cache
      if (value === this.cacheState) {
        return
      }

      // Update the ON/OFF characteristic
      this.service.updateCharacteristic(this.hapChar.On, value)

      // Update the cache and log if appropriate
      this.cacheState = value
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)

      // Don't continue if the new state is OFF
      if (!value) {
        return
      }

      // Wrap the extra brightness request in another try, so it doesn't affect the on/off change
      try {
        // If the new state is ON then we want to update the HomeKit brightness
        const updatedBrightness = await this.getCurrentBrightness()

        // Don't continue if the brightness is the same
        if (updatedBrightness === this.cacheBright) {
          return
        }

        // Update the HomeKit brightness characteristic
        this.service.updateCharacteristic(this.hapChar.Brightness, updatedBrightness)

        // Update the cache and log if appropriate
        this.cacheBright = updatedBrightness
        this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
      } catch (err) {
        this.accessory.logWarn(`${platformLang.brightnessFail} ${parseError(err)}`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalBrightnessUpdate(value) {
    try {
      // Don't continue if the brightness is the same as the cache value
      if (value === this.cacheBright) {
        return
      }
      // Update the HomeKit brightness characteristic
      this.service.updateCharacteristic(this.hapChar.Brightness, value)

      // Update the cache and log if appropriate
      this.cacheBright = value
      this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
