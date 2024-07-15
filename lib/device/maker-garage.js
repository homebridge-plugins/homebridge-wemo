import { parseStringPromise } from 'xml2js'
import platformConsts from '../utils/constants.js'
import { decodeXML, parseError, sleep } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.serialNumber] || {}
    this.doorOpenTimer = deviceConf.makerTimer || platformConsts.defaultValues.makerTimer

    // Some conversion objects
    this.gStates = {
      Open: 0,
      Closed: 1,
      Opening: 2,
      Closing: 3,
      Stopped: 4,
    }

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has a contact sensor service then remove it
    if (this.accessory.getService(this.hapServ.ContactSensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.ContactSensor))
    }

    // Add the garage door service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.GarageDoorOpener)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.GarageDoorOpener)
      this.service.addCharacteristic(this.eveChar.LastActivation)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
      this.service.addCharacteristic(this.eveChar.TimesOpened)
    }

    // Remove unused characteristics
    if (this.service.testCharacteristic(this.hapChar.ContactSensorState)) {
      this.service.removeCharacteristic(
        this.service.getCharacteristic(this.hapChar.ContactSensorState),
      )
    }
    if (this.service.testCharacteristic(this.eveChar.OpenDuration)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.OpenDuration))
    }
    if (this.service.testCharacteristic(this.eveChar.ClosedDuration)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.ClosedDuration))
    }

    // Add the set handler to the garage door reset total characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(() => {
      this.service.updateCharacteristic(this.eveChar.TimesOpened, 0)
    })

    // Add the set handler to the target door state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetDoorState)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('door', this.accessory, {
      log: () => {},
    })
    this.accessory.eveService.addEntry({
      status: this.service.getCharacteristic(this.hapChar.CurrentDoorState).value === 0 ? 0 : 1,
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      makerTimer: this.doorOpenTimer,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)

    // This is to remove the 'No Response' message that is there before the plugin finds this device
    this.service.updateCharacteristic(
      this.hapChar.TargetDoorState,
      this.accessory.context.cacheLastTargetState,
    )

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
        if (attribute.value !== 0) {
          this.externalStateUpdate()
        }
        break
      }
      case 'Sensor': {
        this.externalSensorUpdate(attribute.value, true)
        break
      }
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
      if (attributes.SwitchMode === 0) {
        this.accessory.logWarn(platformLang.makerNeedMMode)
        return
      }
      if (attributes.SensorPresent === 1) {
        this.sensorPresent = true
        this.externalSensorUpdate(attributes.Sensor)
      } else {
        this.sensorPresent = false
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
    const prevTarg = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    const prevCurr = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
    try {
      // Checks to see if the new required movement is already happening
      if (this.isMoving) {
        if (value === this.gStates.Closed && prevCurr === this.gStates.Closing) {
          this.accessory.log(platformLang.makerClosing)
          return
        }
        if (value === this.gStates.Open && prevCurr === this.gStates.Opening) {
          this.accessory.log(platformLang.makerOpening)
          return
        }
      } else if (value === this.gStates.Closed && prevCurr === this.gStates.Closed) {
        this.accessory.log(platformLang.makerClosed)
        return
      } else if (value === this.gStates.Open && prevCurr === this.gStates.Open) {
        this.accessory.log(platformLang.makerOpen)
        return
      }

      // Required movement isn't already in progress so make the new movement happen
      this.homekitTriggered = true

      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: 1,
      })

      // Log the change if appropriate
      this.accessory.log(`${platformLang.tarState} [${value ? platformLang.labelClosed : platformLang.labelOpen}]`)

      // Call the function to set the door moving
      this.accessory.context.cacheLastTargetState = value
      this.setDoorMoving(value, true)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, prevTarg)
        this.accessory.context.cacheLastTargetState = prevTarg
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalStateUpdate() {
    try {
      // We want to ignore update notifications from when controlled through HomeKit
      if (this.homekitTriggered) {
        this.homekitTriggered = false
        return
      }

      // The change of state must have been triggered externally
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      const state = 1 - target
      this.accessory.log(
        `${platformLang.tarState} [${state === 1 ? platformLang.labelClosed : platformLang.labelOpen}] [${platformLang.makerTrigExt}]`,
      )

      // Update the new target state HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, state)
      this.accessory.context.cacheLastTargetState = state

      // If the door has been opened externally then update the Eve-only characteristics
      if (state === 0) {
        this.accessory.eveService.addEntry({ status: 0 })
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
        )
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1,
        )
      }
      this.setDoorMoving(state)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalSensorUpdate(state, wasTriggered) {
    try {
      // 0->1 and 1->0 reverse values to match HomeKit needs
      const value = 1 - state
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      if (target === 0) {
        // CASE target is to OPEN
        if (value === 0) {
          // Garage door HK target state is OPEN and the sensor has reported OPEN
          if (this.isMoving) {
            // Garage door is in the process of opening
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Opening)
            this.accessory.eveService.addEntry({ status: 0 })
            this.service.updateCharacteristic(
              this.eveChar.LastActivation,
              Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
            )
            this.service.updateCharacteristic(
              this.eveChar.TimesOpened,
              this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1,
            )

            // Log the change if appropriate
            this.accessory.log(`${platformLang.curState} [${platformLang.labelOpening}]`)
          } else {
            // Garage door is open and not moving
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Open)

            // Log the change if appropriate
            this.accessory.log(`${platformLang.curState} [${platformLang.labelOpen}]`)
          }
        } else {
          // Garage door HK target state is OPEN and the sensor has reported CLOSED
          // Must have been triggered externally
          this.isMoving = false
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Closed)
          this.accessory.context.cacheLastTargetState = this.gStates.Closed
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closed)
          this.accessory.eveService.addEntry({ status: 1 })

          // Log the change if appropriate
          this.accessory.log(`${platformLang.curState} [${platformLang.labelClosed}] [${platformLang.makerTrigExt}]`)
        }
      } else if (value === 1) {
        // Garage door HK target state is CLOSED and the sensor has reported CLOSED
        this.isMoving = false
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          this.movingTimer = false
        }

        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closed)
        this.accessory.eveService.addEntry({ status: 1 })

        // Log the change if appropriate
        this.accessory.log(`${platformLang.curState} [${platformLang.labelClosed}]`)
      } else {
        // Garage door HK target state is CLOSED but the sensor has reported OPEN
        // Must have been triggered externally
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Open)
        this.accessory.context.cacheLastTargetState = this.gStates.Open
        this.accessory.eveService.addEntry({ status: 0 })
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
        )
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1,
        )

        // Log the change if appropriate
        this.accessory.log(`${platformLang.tarState} [${platformLang.labelOpen}] [${platformLang.makerTrigExt}]`)
        if (wasTriggered) {
          this.setDoorMoving(0)
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  async setDoorMoving(targetDoorState, homekitTriggered) {
    // If a moving timer already exists then stop it
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      this.movingTimer = false
    }

    // The door must have stopped
    if (this.isMoving) {
      this.isMoving = false
      this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 4)
      this.accessory.log(`${platformLang.curState} [${platformLang.labelStopped}]`)

      // Toggle TargetDoorState after receiving a stop
      await sleep(500)
      const target = targetDoorState === this.gStates.Open ? this.gStates.Closed : this.gStates.Open
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, target)
      this.accessory.context.cacheLastTargetState = target
      return
    }

    // Set the moving flag to true
    this.isMoving = true
    if (homekitTriggered) {
      // CASE: triggered through HomeKit
      const curState = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      if (targetDoorState === this.gStates.Closed) {
        // CASE: triggered through HomeKit and requested to CLOSE
        if (curState !== this.gStates.Closed) {
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closing)

          // Log the change if appropriate
          this.accessory.log(`${platformLang.curState} [${platformLang.labelClosing}]`)
        }
      } else if (
        curState === this.gStates.Stopped
        || (curState !== this.gStates.Open && !this.sensorPresent)
      ) {
        // CASE: triggered through HomeKit and requested to OPEN
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Opening)
        this.accessory.eveService.addEntry({ status: 0 })
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
        )
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1,
        )

        // Log the change if appropriate
        this.accessory.log(`${platformLang.curState} [${platformLang.labelOpening}]`)
      }
    }

    // Set up the moving timer
    this.movingTimer = setTimeout(() => {
      this.movingTimer = false
      this.isMoving = false
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      if (!this.sensorPresent) {
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          target === 1 ? this.gStates.Closed : this.gStates.Open,
        )

        // Log the change if appropriate
        this.accessory.log(`${platformLang.curState} [${target === 1 ? platformLang.labelClosed : platformLang.labelOpen}]`)
        return
      }
      if (target === 1) {
        this.accessory.eveService.addEntry({ status: 1 })
      }

      // Request a device update at the end of the timer
      this.requestDeviceUpdate()
    }, this.doorOpenTimer * 1000)
  }
}
