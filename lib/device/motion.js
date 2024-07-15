import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.serialNumber] || {}
    this.noMotionTimer = deviceConf.noMotionTimer || platformConsts.defaultValues.noMotionTimer

    // Add the motion sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.MotionSensor)
    || this.accessory.addService(this.hapServ.MotionSensor)

    // Pass the accessory to fakegato to set up the Eve info service
    this.accessory.historyService = new platform.eveService('motion', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      noMotionTimer: this.noMotionTimer,
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
    // attribute.value is 1 if and only if motion is detected
    this.externalUpdate(attribute.value === 1)
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

  externalUpdate(value) {
    try {
      // Obtain the previous state of the motion sensor
      const prevState = this.service.getCharacteristic(this.hapChar.MotionDetected).value

      // Don't continue in the following cases:
      // (1) the previous state is the same as before and the motion timer isn't running
      // (2) the new value is 'no motion detected' but the motion timer is still running
      if ((value === prevState && !this.motionTimer) || (!value && this.motionTimer)) {
        return
      }

      // Next logic depends on two cases
      if (value || this.noMotionTimer === 0) {
        // CASE: new motion detected or the user motion timer is set to 0 seconds
        // If a motion timer is already present then stop it
        if (this.motionTimer) {
          this.accessory.log(platformLang.timerStopped)
          clearTimeout(this.motionTimer)
          this.motionTimer = false
        }

        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.hapChar.MotionDetected, value)

        // Add the entry to Eve
        this.accessory.historyService.addEntry({ status: value ? 1 : 0 })

        // If motion detected then update the LastActivation Eve characteristic
        if (value) {
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - this.accessory.historyService.getInitialTime(),
          )
        }

        // Log the change if appropriate
        this.accessory.log(`${platformLang.motionSensor} [${value ? platformLang.motionYes : platformLang.motionNo}]`)
      } else {
        // CASE: motion not detected and the user motion timer is more than 0 seconds
        this.accessory.log(`${platformLang.timerStarted} [${this.noMotionTimer}s]`)

        // Clear any existing timers
        clearTimeout(this.motionTimer)

        // Create a new 'no motion timer'
        this.motionTimer = setTimeout(() => {
          // Update the HomeKit characteristic to false
          this.service.updateCharacteristic(this.hapChar.MotionDetected, false)

          // Add a no motion detected value to Eve
          this.accessory.historyService.addEntry({ status: 0 })

          // Log the change if appropriate
          this.accessory.log(`${platformLang.motionSensor} [${platformLang.motionNo}] [${platformLang.timerComplete}]`)

          // Set the motion timer in use to false
          this.motionTimer = false
        }, this.noMotionTimer * 1000)
      }
    } catch (err) {
      // Catch any errors
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
