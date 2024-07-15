import { parseStringPromise } from 'xml2js'
import { decodeXML, parseError } from '../utils/functions.js'
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
    this.reversePolarity = deviceConf.reversePolarity

    // If the accessory has a garage door service then remove it
    if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.GarageDoorOpener))
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
    || this.accessory.addService(this.hapServ.Switch)

    // This is used to remove any no response status on startup
    this.service.updateCharacteristic(
      this.hapChar.On,
      this.service.getCharacteristic(this.hapChar.On).value || false,
    )

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

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
      case 'Switch': {
        const hkValue = attribute.value === 1
        this.externalStateUpdate(hkValue)
        break
      }
      case 'Sensor':
        this.externalSensorUpdate(attribute.value)
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
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes',
      )

      // Parse the response
      const decoded = decodeXML(data.attributeList)
      const xml = `<attributeList>${decoded}</attributeList>`
      const result = await parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      Object.keys(result.attributeList.attribute).forEach((key) => {
        const attribute = result.attributeList.attribute[key]
        attributes[attribute.name] = Number.parseInt(attribute.value, 10)
      })

      // Only send the required attributes to the receiveDeviceUpdate function
      if (attributes.Switch) {
        this.externalStateUpdate(attributes.Switch === 1)
      }

      // Check to see if the accessory has a contact sensor
      const contactSensor = this.accessory.getService(this.hapServ.ContactSensor)
      if (attributes.SensorPresent === 1) {
        // Add a contact sensor service if the physical device has one
        if (!contactSensor) {
          this.accessory.addService(this.hapServ.ContactSensor)
        }
        if (attributes.Sensor) {
          this.externalSensorUpdate(attributes.Sensor)
        }
      } else if (contactSensor) {
        // Remove the contact sensor service if the physical device doesn't have one
        this.accessory.removeService(contactSensor)
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
      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0,
      })

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

  externalStateUpdate(value) {
    try {
      // Don't continue if the value is the same as before
      if (value === this.cacheState) {
        return
      }

      // Update the HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.On, value)

      // Update the cache and log if appropriate
      this.cacheState = value
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalSensorUpdate(value) {
    try {
      // Reverse the polarity if enabled by user
      if (this.reversePolarity) {
        value = 1 - value
      }

      // Don't continue if the sensor value is the same as before
      if (value === this.cacheContact) {
        return
      }

      // Update the HomeKit characteristic
      this.accessory
        .getService(this.hapServ.ContactSensor)
        .updateCharacteristic(this.hapChar.ContactSensorState, value)

      // Update the cache and log the change if appropriate
      this.cacheContact = value
      this.accessory.log(`${platformLang.curCont} [${value === 1 ? platformLang.detectedNo : platformLang.detectedYes}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
