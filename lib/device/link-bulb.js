import { parseStringPromise } from 'xml2js'
import {
  hs2rgb,
  rgb2hs,
  rgb2xy,
  xy2rgb,
} from '../utils/colour.js'
import platformConsts from '../utils/constants.js'
import { generateRandomString, parseError, sleep } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, priAcc, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.priAcc = priAcc

    // Set up variables from the device
    this.deviceID = accessory.context.deviceId

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[this.deviceID] || {}
    this.brightStep = deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platformConsts.defaultValues.brightnessStep
    this.alShift = deviceConf.adaptiveLightingShift || platformConsts.defaultValues.adaptiveLightingShift
    this.transitionTime = deviceConf.transitionTime || platformConsts.defaultValues.transitionTime

    // Objects containing mapping info for the device capabilities
    this.linkCodes = {
      switch: '10006',
      brightness: '10008',
      color: '10300',
      temperature: '30301',
    }
    this.linkCodesRev = {
      10600: 'switch',
      10008: 'brightness',
      10300: 'color',
      30301: 'temperature',
    }

    // Quick check variables for later use
    this.hasBrightSupport = accessory.context.capabilities[this.linkCodes.brightness]
    this.hasColourSupport = accessory.context.capabilities[this.linkCodes.color]
    && deviceConf?.enableColourControl
    this.hasCTempSupport = accessory.context.capabilities[this.linkCodes.temperature]

    // Add the lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
    || this.accessory.addService(this.hapServ.Lightbulb)

    // If adaptive lighting has just been disabled then remove and re-add service to hide AL icon
    if (this.alShift === -1 && this.accessory.context.adaptiveLighting) {
      this.accessory.removeService(this.service)
      this.service = this.accessory.addService(this.hapServ.Lightbulb)
      this.accessory.context.adaptiveLighting = false
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the brightness characteristic if supported
    if (this.hasBrightSupport) {
      this.service
        .getCharacteristic(this.hapChar.Brightness)
        .setProps({ minStep: this.brightStep })
        .onSet(async (value) => {
          await this.internalBrightnessUpdate(value)
        })
    }

    // Add the set handler to the colour temperature characteristic if supported
    if (this.hasColourSupport) {
      this.service.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
        await this.internalColourUpdate(value)
      })
      this.cacheHue = this.service.getCharacteristic(this.hapChar.Hue).value
      this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value
    } else {
      if (this.service.testCharacteristic(this.hapChar.Hue)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.Hue))
      }
      if (this.service.testCharacteristic(this.hapChar.Saturation)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.Saturation))
      }
    }

    // Add the set handler to the colour temperature characteristic if supported
    if (this.hasCTempSupport) {
      this.service.getCharacteristic(this.hapChar.ColorTemperature).onSet(async (value) => {
        await this.internalCTUpdate(value)
      })
      this.cacheMired = this.service.getCharacteristic(this.hapChar.ColorTemperature).value

      // Add support for adaptive lighting if not disabled by user
      if (this.alShift !== -1) {
        this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
          customTemperatureAdjustment: this.alShift,
        })
        this.accessory.configureController(this.alController)
      }
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      adaptiveLightingShift: this.alShift,
      brightnessStep: this.brightStep,
      transitionTime: this.transitionTime,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate(attribute) {
    // Log the receiving update if debug is enabled
    this.accessory.logDebug(`${platformLang.recUpd} [${this.linkCodesRev[attribute.name]}: ${attribute.value}]`)

    // Check which attribute we are getting
    switch (attribute.name) {
      case this.linkCodes.switch:
        // Need a HomeKit true/false value for the state update
        this.externalStateUpdate(Number.parseInt(attribute.value, 10) !== 0)
        break
      case this.linkCodes.brightness:
        // Need a HomeKit int value for the brightness update
        this.externalBrightnessUpdate(Math.round(attribute.value.split(':').shift() / 2.55))
        break
      case this.linkCodes.color: {
        if (this.hasColourSupport) {
          // Need a HomeKit int values for the colour update
          const xy = attribute.value.split(':')
          this.externalColourUpdate(xy[0], xy[1])
        }
        break
      }
      case this.linkCodes.temperature:
        // Need a HomeKit int value for the colour temperature update
        this.externalCTUpdate(Math.round(attribute.value.split(':').shift()))
        break
      default:
    }
  }

  async sendDeviceUpdate(capability, value) {
    // Log the sending update if debug is enabled
    this.accessory.logDebug(`${platformLang.senUpd} [${capability}: ${value}]`)

    // Send the update
    await this.priAcc.control.sendDeviceUpdate(
      this.accessory.context.serialNumber,
      capability,
      value,
    )
  }

  async requestDeviceUpdate() {
    try {
      // Request the update via the main (hidden) accessory
      const data = await this.priAcc.control.requestDeviceUpdate(
        this.accessory.context.serialNumber,
      )

      // Parse the response
      const res = await parseStringPromise(data.DeviceStatusList, { explicitArray: false })
      const deviceStatus = res.DeviceStatusList.DeviceStatus
      const values = deviceStatus.CapabilityValue.split(',')
      const caps = {}
      deviceStatus.CapabilityID.split(',').forEach((val, index) => {
        caps[val] = values[index]
      })

      // If no capability values received then device must be offline
      if (!caps[this.linkCodes.switch] || !caps[this.linkCodes.switch].length) {
        this.accessory.logWarn(platformLang.devOffline)
        return
      }

      // Need a HomeKit true/false value for the state update
      if (caps[this.linkCodes.switch]) {
        this.externalStateUpdate(Number.parseInt(caps[this.linkCodes.switch], 10) !== 0)
      }

      // Need a HomeKit int value for the brightness update
      if (caps[this.linkCodes.brightness] && this.hasBrightSupport) {
        this.externalBrightnessUpdate(
          Math.round(caps[this.linkCodes.brightness].split(':').shift() / 2.55),
        )
      }

      // Need a HomeKit int value for the colour update
      if (caps[this.linkCodes.color] && this.hasColourSupport) {
        const xy = caps[this.linkCodes.color].split(':')
        this.externalColourUpdate(xy[0], xy[1])
      }

      // Need a HomeKit int value for the colour temperature update
      if (caps[this.linkCodes.temperature] && this.hasCTempSupport) {
        this.externalCTUpdate(Math.round(caps[this.linkCodes.temperature].split(':').shift()))
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

  async internalStateUpdate(value) {
    try {
      // Wait a longer time than the brightness so in scenes brightness is sent first
      await sleep(500)

      // Send the update
      await this.sendDeviceUpdate(this.linkCodes.switch, value ? 1 : 0)

      // Update the cache and log if appropriate
      this.cacheState = value
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
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
      this.updateKeyBR = updateKey
      await sleep(300)
      if (updateKey !== this.updateKeyBR) {
        return
      }

      // Don't continue if this value is same as before
      if (this.cacheBright === value) {
        return
      }

      // Send the update - value = brightness:transition_time
      await this.sendDeviceUpdate(
        this.linkCodes.brightness,
        `${value * 2.55}:${this.transitionTime}`,
      )

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

  async internalColourUpdate(value) {
    try {
      // Avoid multiple updates in quick succession
      const updateKey = generateRandomString(5)
      this.updateKeyHue = updateKey
      await sleep(400)
      if (updateKey !== this.updateKeyHue) {
        return
      }

      // Don't continue if this value is same as before
      if (this.cacheHue === value) {
        return
      }

      // First convert to RGB
      const currentSat = this.service.getCharacteristic(this.hapChar.Saturation).value
      const [r, g, b] = hs2rgb(value, currentSat)

      // Then convert the RGB to the values needed for Wemo
      const [x, y] = rgb2xy(r, g, b)
      const X = Math.round(x * 65535)
      const Y = Math.round(y * 65535)

      // Send the update - value = ct:transition_time
      await this.sendDeviceUpdate(this.linkCodes.color, `${X}:${Y}:${this.transitionTime}`)

      // Update the cache and log if appropriate
      this.cacheHue = value
      this.cacheSat = currentSat
      this.cacheMired = 0
      this.accessory.log(`${platformLang.curColour} [X:${X} Y:${Y}]`)
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCTUpdate(value) {
    try {
      // Avoid multiple updates in quick succession
      const updateKey = generateRandomString(5)
      this.updateKeyCT = updateKey
      await sleep(400)
      if (updateKey !== this.updateKeyCT) {
        return
      }

      // Value needs to be between 170 and 370
      value = Math.min(Math.max(value, 170), 370)

      // Don't continue if this value is same as before
      if (this.cacheMired === value) {
        return
      }

      // Send the update - value = ct:transition_time
      await this.sendDeviceUpdate(this.linkCodes.temperature, `${value}:${this.transitionTime}`)

      // Update the cache and log if appropriate
      this.cacheMired = value
      this.cacheHue = 0
      this.cacheSat = 0
      // Convert mired value to kelvin for logging
      const mToK = Math.round(1000000 / value)
      if (this.alController?.isAdaptiveLightingActive()) {
        this.accessory.log(`${platformLang.curCCT} [${mToK}K / ${value}M] ${platformLang.viaAL}`)
      } else {
        this.accessory.log(`${platformLang.curCCT} [${mToK}K / ${value}M]`)
      }
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalStateUpdate(value) {
    try {
      // Don't continue if the state is the same as before
      if (value === this.cacheState) {
        return
      }

      // Update the state HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.On, value)

      // Update the cache and log if appropriate
      this.cacheState = value
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalBrightnessUpdate(value) {
    try {
      // Don't continue if the brightness is the same as before
      if (value === this.cacheBright) {
        return
      }

      // Update the brightness HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.Brightness, value)

      // Update the cache and log if appropriate
      this.cacheBright = value
      this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalColourUpdate(valueX, valueY) {
    try {
      // Convert the given values to RGB and hue/saturation
      const [r, g, b] = xy2rgb(valueX / 65535, valueY / 65535)
      const [h, s] = rgb2hs(r, g, b)

      // Don't continue if the hue and saturation are the same as before
      if (this.cacheHue !== h || this.cacheSat !== s) {
        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, 140)
        this.service.updateCharacteristic(this.hapChar.Hue, h)
        this.service.updateCharacteristic(this.hapChar.Saturation, s)

        // Update the cache values
        this.cacheMired = 0
        this.cacheHue = h
        this.cacheSat = s

        // Log the change if appropriate
        this.accessory.log(`${platformLang.curColour} [X:${valueX} Y:${valueY}]`)

        // Colour chosen externally so disable adaptive lighting
        if (this.alController?.isAdaptiveLightingActive()) {
          this.alController.disableAdaptiveLighting()
          this.accessory.log(platformLang.alDisabled)
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalCTUpdate(value) {
    try {
      // Don't continue if the mired value is the same as before
      if (value === this.cacheMired) {
        return
      }

      // Update the mired HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.ColorTemperature, value)

      // Log the change if appropriate
      const mToK = Math.round(1000000 / value)
      this.accessory.log(`${platformLang.curCCT} [${mToK}K / ${value}M]`)

      // If the difference is significant (>20) then disable adaptive lighting
      if (!Number.isNaN(this.cacheMired)) {
        const diff = Math.abs(value - this.cacheMired) > 20
        if (this.alController?.isAdaptiveLightingActive() && diff) {
          this.alController.disableAdaptiveLighting()
          this.accessory.log(platformLang.alDisabled)
        }
      }

      // Update the cache value after the adaptive lighting check
      this.cacheMired = value
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
