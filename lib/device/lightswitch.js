import { hasProperty, parseError } from '../utils/functions.js'
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

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // If the accessory has an air purifier service then remove it
    if (this.accessory.getService(this.hapServ.AirPurifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.AirPurifier))
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
    || this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Pass the accessory to fakegato to set up the eve info service
    this.accessory.historyService = new platform.eveService('switch', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'switch',
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

    // Send a HomeKit needed true/false argument
    // attribute.value is 0 if and only if the switch is off
    this.externalStateUpdate(attribute.value !== 0)
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
        // Send the data to the receiver function
        this.receiveDeviceUpdate({
          name: 'BinaryState',
          value: Number.parseInt(data.BinaryState, 10),
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

  async internalStateUpdate(value) {
    try {
      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0,
      })

      // Update the cache value
      this.cacheState = value
      this.accessory.historyService.addEntry({ status: value ? 1 : 0 })

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
    } catch (err) {
      // Catch any errors
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
      // Check to see if the cache value is different
      if (value === this.cacheState) {
        return
      }

      // Update the HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.On, value)

      // Update the cache value
      this.cacheState = value

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
      this.accessory.historyService.addEntry({ status: value ? 1 : 0 })
    } catch (err) {
      // Catch any errors
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
