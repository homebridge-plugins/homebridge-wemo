import platformConsts from '../../utils/constants.js'
import { hasProperty, parseError } from '../../utils/functions.js'
import platformLang from '../../utils/lang-en.js'

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
    this.showTodayTC = deviceConf.showTodayTC
    this.wattDiff = deviceConf.wattDiff || platformConsts.defaultValues.wattDiff
    this.timeDiff = deviceConf.timeDiff || platformConsts.defaultValues.timeDiff
    if (this.timeDiff === 1) {
      this.timeDiff = false
    }
    this.skipTimeDiff = false

    if (!hasProperty(this.accessory.context, 'cacheLastWM')) {
      this.accessory.context.cacheLastWM = 0
    }
    if (!hasProperty(this.accessory.context, 'cacheLastTC')) {
      this.accessory.context.cacheLastTC = 0
    }
    if (!hasProperty(this.accessory.context, 'cacheTotalTC')) {
      this.accessory.context.cacheTotalTC = 0
    }

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the purifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.AirPurifier)
    || this.accessory.addService(this.hapServ.AirPurifier)

    // Add the Eve power characteristics
    if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
      this.service.addCharacteristic(this.eveChar.CurrentConsumption)
    }
    if (!this.service.testCharacteristic(this.eveChar.TotalConsumption)) {
      this.service.addCharacteristic(this.eveChar.TotalConsumption)
    }
    if (!this.service.testCharacteristic(this.eveChar.ResetTotal)) {
      this.service.addCharacteristic(this.eveChar.ResetTotal)
    }

    // Add the set handler to the purifier active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .removeOnSet()
      .onSet(async value => this.internalStateUpdate(value))

    // Add options to the purifier target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetAirPurifierState).setProps({
      minValue: 1,
      maxValue: 1,
      validValues: [1],
    })
    this.service.updateCharacteristic(this.hapChar.TargetAirPurifierState, 1)

    // Add the set handler to the switch reset (eve) characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(() => {
      this.accessory.context.cacheLastWM = 0
      this.accessory.context.cacheLastTC = 0
      this.accessory.context.cacheTotalTC = 0
      this.service.updateCharacteristic(this.eveChar.TotalConsumption, 0)
    })

    // Pass the accessory to fakegato to set up the Eve info service
    this.accessory.historyService = new platform.eveService('energy', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'purifier',
      showTodayTC: this.showTodayTC,
      timeDiff: this.timeDiff,
      wattDiff: this.wattDiff,
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

    // Let's see which attribute has been provided
    switch (attribute.name) {
      case 'BinaryState': {
        // BinaryState is reported as 0=off, 1=on, 8=standby
        // Send a HomeKit needed 1/0 argument (0=0, 1,8=1)
        this.externalStateUpdate(attribute.value === 0 ? 0 : 1)
        break
      }
      case 'InsightParams':
        // Send the insight data straight to the function
        this.externalInsightUpdate(
          attribute.value.state,
          attribute.value.power,
          attribute.value.todayWm,
          attribute.value.todayOnSeconds,
        )
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

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curState} [${value ? platformLang.purifyYes : platformLang.purifyNo}]`)

      // If turning the switch off then update the purifying state and current consumption
      if (!value) {
        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, 0)
        this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, 0)

        // Add an Eve entry for no power
        this.accessory.historyService.addEntry({ power: 0 })

        // Log the change if appropriate
        this.accessory.log(`${platformLang.curCons} [0W]`)
      } else {
        // Set the current state to purifying
        this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, 2)
      }
    } catch (err) {
      const eText = parseError(err, [platformLang.timeout, platformLang.timeoutUnreach])
      this.accessory.logWarn(`${platformLang.cantCtl} ${eText}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalInsightUpdate(value, power, todayWm, todayOnSeconds) {
    // Update whether the switch is ON (value=1) or OFF (value=0)
    this.externalStateUpdate(value === 0 ? 0 : 1)

    // Update whether the outlet-in-use is YES (value=1) or NO (value=0,8)
    this.externalInUseUpdate(value === 1)

    // Update the total consumption
    this.externalTotalConsumptionUpdate(todayWm, todayOnSeconds)

    // Update the current consumption
    this.externalConsumptionUpdate(power)
  }

  externalStateUpdate(value) {
    try {
      // Check to see if the cache value is different
      if (value === this.cacheState) {
        return
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value)

      // Update the cache value
      this.cacheState = value

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curState} [${value ? platformLang.purifyYes : platformLang.purifyNo}]`)

      // If the device has turned off then update the current consumption
      if (!value) {
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      // Catch any errors
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalInUseUpdate(value) {
    try {
      // Check to see if the cache value is different
      if (value === this.cacheInUse) {
        return
      }

      // Update the HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, value ? 2 : 1)

      // Update the cache value
      this.cacheInUse = value

      // Log the change if appropriate
      this.accessory.log(`${platformLang.curState} [${value ? platformLang.purifyYes : platformLang.purifyNo}]`)
    } catch (err) {
      // Catch any errors
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalConsumptionUpdate(power) {
    try {
      // Divide by 1000 to get the power value in W
      const powerInWatts = Math.round(power / 1000)

      // Check to see if the cache value is different
      if (powerInWatts === this.cachePowerInWatts) {
        return
      }

      // Update the power in watts cache
      this.cachePowerInWatts = powerInWatts

      // Update the HomeKit characteristic
      this.service.updateCharacteristic(this.eveChar.CurrentConsumption, this.cachePowerInWatts)

      // Add the Eve wattage entry
      this.accessory.historyService.addEntry({ power: this.cachePowerInWatts })

      // Calculate a difference from the last reading
      const diff = Math.abs(powerInWatts - this.cachePowerInWatts)

      // Don't continue with logging if the user has set a timeout between entries or a min difference between entries
      if (!this.skipTimeDiff && diff >= this.wattDiff) {
        // Log the change if appropriate
        this.accessory.log(`${platformLang.curCons} [${this.cachePowerInWatts}W]`)

        // Set the time difference timeout if needed
        if (this.timeDiff) {
          this.skipTimeDiff = true
          setTimeout(() => {
            this.skipTimeDiff = false
          }, this.timeDiff * 1000)
        }
      }
    } catch (err) {
      // Catch any errors
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }

  externalTotalConsumptionUpdate(todayWm, todayOnSeconds) {
    try {
      if (todayWm === this.accessory.context.cacheLastWM) {
        return
      }

      // Update the cache last value
      this.accessory.context.cacheLastWM = todayWm

      // Convert to Wh (hours) from raw data of Wm (minutes)
      const todayWh = Math.round(todayWm / 60000)

      // Convert to kWh
      const todaykWh = todayWh / 1000

      // Convert to hours, minutes and seconds (HH:MM:SS)
      const todayOnHours = new Date(todayOnSeconds * 1000).toISOString().substr(11, 8)

      // Calculate the difference (ie extra usage from the last reading)
      const difference = Math.max(todaykWh - this.accessory.context.cacheLastTC, 0)

      // Update the caches
      this.accessory.context.cacheTotalTC += difference
      this.accessory.context.cacheLastTC = todaykWh

      // Update the total consumption characteristic
      this.service.updateCharacteristic(
        this.eveChar.TotalConsumption,
        this.showTodayTC ? todaykWh : this.accessory.context.cacheTotalTC,
      )

      if (!this.skipTimeDiff) {
        this.accessory.log(
          `${platformLang.insOnTime} [${todayOnHours}] ${platformLang.insCons} [${todaykWh.toFixed(3)} kWh] ${platformLang.insTC} [${this.accessory.context.cacheTotalTC.toFixed(3)} kWh]`,
        )
      }
    } catch (err) {
      // Catch any errors
      this.accessory.logWarn(`${platformLang.cantUpd} ${parseError(err)}`)
    }
  }
}
