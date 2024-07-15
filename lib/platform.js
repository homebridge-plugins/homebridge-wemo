import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import { URL as url } from 'node:url'
import process from 'node:process'
import axios from 'axios'
import ip from 'ip'
import nodeSSDP from 'node-ssdp'
import { parseStringPromise } from 'xml2js'
import { create as xmlCreate } from 'xmlbuilder'
import httpClient from './connection/http.js'
import upnpClient from './connection/upnp.js'
import deviceTypes from './device/index.js'
import eveService from './fakegato/fakegato-history.js'
import platformConsts from './utils/constants.js'
import eveChars from './utils/eve-chars.js'
import { parseError, parseSerialNumber } from './utils/functions.js'
import platformLang from './utils/lang-en.js'

const { Client: ssdp } = nodeSSDP
const require = createRequire(import.meta.url)
const plugin = require('../package.json')

const devicesInHB = new Map()

let listenerServer
let cacheSerialsToConnect = []
let existSerialsToConnect = []
let ssdpClient

export default class {
  constructor(log, config, api) {
    if (!log || !api) {
      return
    }

    // Begin plugin initialisation
    try {
      this.api = api
      this.log = log
      this.isBeta = plugin.version.includes('beta')

      // Configuration objects for accessories
      this.ignoredDevices = []
      this.manualDevices = []
      this.deviceConf = {}

      // Make sure user is running Homebridge v1.5 or above
      if (!api?.versionGreaterOrEqual('1.5.0')) {
        throw new Error(platformLang.hbVersionFail)
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(platformLang.notConfigured)
      }

      // Log some environment info for debugging
      this.log(
        '%s v%s | System %s | Node %s | HB v%s | HAPNodeJS v%s...',
        platformLang.initialising,
        plugin.version,
        process.platform,
        process.version,
        api.serverVersion,
        api.hap.HAPLibraryVersion(),
      )

      // Apply the user's configuration
      this.config = platformConsts.defaultConfig
      this.applyUserConfig(config)

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup())
      this.api.on('shutdown', () => this.pluginShutdown())
    } catch (err) {
      // Catch any errors during initialisation
      const eText = parseError(err, [platformLang.hbVersionFail, platformLang.notConfigured])
      log.warn('***** %s. *****', platformLang.disabling)
      log.warn('***** %s. *****', eText)
    }
  }

  applyUserConfig(config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgDef, def)
    }
    const logDuplicate = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgDup)
    }
    const logIgnore = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgn)
    }
    const logIgnoreItem = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgnItem)
    }
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgLow, min)
    }
    const logQuotes = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgQts)
    }
    const logRemove = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgRmv)
    }

    // Begin applying the user's config
    Object.entries(config).forEach((entry) => {
      const [key, val] = entry
      switch (key) {
        case 'disableDeviceLogging':
        case 'disableUPNP':
        case 'hideConnectionErrors':
          if (typeof val === 'string') {
            logQuotes(key)
          }
          this.config[key] = val === 'false' ? false : !!val
          break
        case 'discoveryInterval':
        case 'pollingInterval':
        case 'upnpInterval': {
          if (typeof val === 'string') {
            logQuotes(key)
          }
          const intVal = Number.parseInt(val, 10)
          if (Number.isNaN(intVal)) {
            logDefault(key, platformConsts.defaultValues[key])
            this.config[key] = platformConsts.defaultValues[key]
          } else if (intVal < platformConsts.minValues[key]) {
            logIncrease(key, platformConsts.minValues[key])
            this.config[key] = platformConsts.minValues[key]
          } else {
            this.config[key] = intVal
          }
          break
        }
        case 'makerTypes':
        case 'wemoInsights':
        case 'wemoLights':
        case 'wemoLinks':
        case 'wemoMotions':
        case 'wemoOthers':
        case 'wemoOutlets':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach((x) => {
              if (!x.serialNumber) {
                logIgnoreItem(key)
                return
              }
              const id = parseSerialNumber(x.serialNumber)
              if (Object.keys(this.deviceConf).includes(id)) {
                logDuplicate(`${key}.${id}`)
                return
              }
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(`${key}.${id}`)
                return
              }
              this.deviceConf[id] = {}
              cacheSerialsToConnect.push(id)
              entries.forEach((subEntry) => {
                const [k, v] = subEntry
                if (!platformConsts.allowed[key].includes(k)) {
                  logRemove(`${key}.${id}.${k}`)
                  return
                }
                switch (k) {
                  case 'adaptiveLightingShift':
                  case 'brightnessStep':
                  case 'makerTimer':
                  case 'noMotionTimer':
                  case 'timeDiff':
                  case 'transitionTime':
                  case 'wattDiff': {
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    const intVal = Number.parseInt(v, 10)
                    if (Number.isNaN(intVal)) {
                      logDefault(`${key}.${id}.${k}`, platformConsts.defaultValues[k])
                      this.deviceConf[id][k] = platformConsts.defaultValues[k]
                    } else if (intVal < platformConsts.minValues[k]) {
                      logIncrease(`${key}.${id}.${k}`, platformConsts.minValues[k])
                      this.deviceConf[id][k] = platformConsts.minValues[k]
                    } else {
                      this.deviceConf[id][k] = intVal
                    }
                    break
                  }
                  case 'label':
                  case 'serialNumber':
                    this.deviceConf[id][k] = v
                    break
                  case 'listenerType':
                  case 'showAs': {
                    const inSet = platformConsts.allowed[k].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(`${key}.${id}.${k}`)
                    }
                    this.deviceConf[id][k] = inSet ? v : platformConsts.defaultValues[k]
                    break
                  }
                  case 'makerType':
                    this.deviceConf[id].showAsGarage = x[k].toString() === 'garageDoor'
                    break
                  case 'manualIP':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      const manualIp = v
                        .toString()
                        .toLowerCase()
                        .replace(/[\s'"]+/g, '')
                      this.manualDevices.push(manualIp)
                    }
                    break
                  case 'enableColourControl':
                  case 'outletInUseTrue':
                  case 'reversePolarity':
                  case 'showTodayTC':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    this.deviceConf[id][k] = v === 'false' ? false : !!v
                    break
                  case 'ignoreDevice':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    if (!!v && v !== 'false') {
                      this.ignoredDevices.push(id)
                    }
                    break
                  default:
                }
              })
            })
          } else {
            logIgnore(key)
          }
          break
        case 'mode': {
          const inSet = platformConsts.allowed[key].includes(val)
          if (typeof val !== 'string' || !inSet) {
            logIgnore(key)
          }
          this.config.mode = inSet ? val : 'auto'
          break
        }
        case 'name':
        case 'platform':
          break
        case 'removeByName':
          if (typeof val !== 'string' || val === '') {
            logIgnore(key)
          }
          this.config.removeByName = val
          break
        case 'wemoClient':
          if (typeof val === 'object' && Object.keys(val).length > 0) {
            Object.entries(val).forEach((subEntry) => {
              const [k1, v1] = subEntry
              switch (k1) {
                case 'callback_url':
                  if (typeof v1 !== 'string' || v1 === '') {
                    logIgnore(`${key}.${k1}`)
                  }
                  this.config.callbackOverride = v1.replace('http://', '').replace(/\/\s*$/, '')
                  break
                case 'discover_opts':
                  if (typeof v1 === 'object' && Object.keys(v1).length > 0) {
                    Object.entries(v1).forEach((subSubEntry) => {
                      const [k2, v2] = subSubEntry
                      switch (k2) {
                        case 'explicitSocketBind':
                          if (typeof v2 === 'string') {
                            logQuotes(`${key}.${k1}.${k2}`)
                          }
                          this.config[key][k1][k2] = v2 === 'false' ? false : !!v2
                          break
                        case 'interfaces':
                          if (typeof v2 !== 'string' || v2 === '') {
                            logIgnore(`${key}.${k1}.${k2}`)
                          }
                          this.config[key][k1][k2] = v2.toString()
                          break
                        default:
                          logRemove(`${key}.${k1}.${k2}`)
                          break
                      }
                    })
                  } else {
                    logIgnore(`${key}.${k1}`)
                  }
                  break
                case 'listen_interface':
                  if (typeof v1 !== 'string' || v1 === '') {
                    logIgnore(`${key}.${k1}`)
                  }
                  this.config[key][k1] = v1
                  break
                case 'port': {
                  if (typeof val === 'string') {
                    logQuotes(`${key}.${k1}`)
                  }
                  const intVal = Number.parseInt(v1, 10)
                  if (Number.isNaN(intVal)) {
                    logDefault(`${key}.${k1}`, platformConsts.defaultValues[k1])
                    this.config[key][k1] = platformConsts.defaultValues[k1]
                  } else if (intVal < platformConsts.minValues[k1]) {
                    logIncrease(`${key}.${k1}`, platformConsts.minValues[k1])
                    this.config[key][k1] = platformConsts.minValues[k1]
                  } else {
                    this.config[key][k1] = intVal
                  }
                  break
                }
                default:
                  logRemove(`${key}.${k1}`)
                  break
              }
            })
          } else {
            logIgnore(key)
          }
          break
        default:
          logRemove(key)
          break
      }
    })
  }

  pluginSetup() {
    // Plugin has finished initialising so now onto setup
    try {
      // Log that the plugin initialisation has been successful
      this.log('%s.', platformLang.initialised)

      // Sort out some logging functions
      if (this.isBeta) {
        this.log.debug = this.log
        this.log.debugWarn = this.log.warn

        // Log that using a beta will generate a lot of debug logs
        if (this.isBeta) {
          const divide = '*'.repeat(platformLang.beta.length + 1) // don't forget the full stop (+1!)
          this.log.warn(divide)
          this.log.warn(`${platformLang.beta}.`)
          this.log.warn(divide)
        }
      } else {
        this.log.debug = () => {}
        this.log.debugWarn = () => {}
      }

      // Set up the discovery run counter
      this.discoveryRun = -1

      // Require any libraries that the accessory instances use
      this.eveChar = new eveChars(this.api)
      this.eveService = eveService(this.api)

      // Set up the http client
      this.httpClient = new httpClient(this)

      // Configure each accessory restored from the cache
      devicesInHB.forEach((accessory) => {
        // If it's in the 'ignore list' or the removeByName option then remove
        if (
          this.ignoredDevices.includes(accessory.context.serialNumber.toUpperCase())
          || this.config.removeByName === accessory.displayName
          || (this.config.mode === 'semi'
          && !cacheSerialsToConnect.includes(accessory.context.serialNumber))
        ) {
          this.removeAccessory(accessory)
          return
        }

        // Make the accessory show as 'No Response' until it has been discovered
        const { services } = accessory
        services.forEach((service) => {
          let charToError
          switch (service.constructor.name) {
            case 'AirPurifier':
            case 'HeaterCooler':
            case 'HumidifierDehumidifier':
              charToError = 'Active'
              break
            case 'GarageDoorOpener':
              charToError = 'TargetDoorState'
              break
            case 'Lightbulb':
            case 'Outlet':
            case 'Switch':
              charToError = 'On'
              break
            default:
              return
          }
          service
            .getCharacteristic(this.api.hap.Characteristic[charToError])
            .onSet(() => {
              this.log.warn('[%s] %s.', accessory.displayName, platformLang.accNotReady)
              throw new this.api.hap.HapStatusError(-70402)
            })
            .updateValue(new this.api.hap.HapStatusError(-70402))
        })

        // Update the context that the accessory can't be controlled until discovered
        accessory.context.initialised = false
        accessory.context.httpOnline = false
        accessory.context.upnpOnline = false

        // Add the accessory to cache accessories to connect to if it isn't already
        if (!cacheSerialsToConnect.includes(accessory.context.serialNumber)) {
          cacheSerialsToConnect.push()
        }

        // Update the changes to the accessory to the platform
        this.api.updatePlatformAccessories([accessory])
        devicesInHB.set(accessory.UUID, accessory)
      })

      // Set up the listener server for device notifications
      listenerServer = createServer((req, res) => {
        let body = ''
        const accessory = devicesInHB.get(req.url.substring(1))
        if (req.method === 'NOTIFY' && accessory) {
          // A notification from a known device
          req.on('data', (chunk) => {
            body += chunk.toString()
          })
          req.on('end', () => this.httpClient.receiveDeviceUpdate(accessory, body))
        }
        res.writeHead(200)
        res.end()
      })

      // Start listening on the above created server
      if (this.config.wemoClient.listen_interface) {
        // User has defined a specific network interface to listen on
        listenerServer.listen(this.config.wemoClient.port, this.getLocalInterfaceAddress(), (err) => {
          if (err) {
            this.log.warn('%s: %s.', platformLang.listenerError, err)
          } else if (this.config.debug) {
            // Log the port of the listener server in debug mode
            this.log('%s [%s].', platformLang.listenerPort, listenerServer.address().port)
          }
        })
      } else {
        // User has not defined a specific network interface to listen on
        listenerServer.listen(this.config.wemoClient.port, (err) => {
          if (err) {
            this.log.warn('%s: %s', platformLang.listenerError, err)
          } else if (this.config.debug) {
            // Log the port of the listener server in debug mode
            this.log('%s [%s].', platformLang.listenerPort, listenerServer.address().port)
          }
        })
      }

      // Set up the SSDP client if the user has not specified manual devices only
      if (this.config.mode !== 'manual') {
        if (this.isBeta) {
          this.config.wemoClient.discover_opts.customLogger = this.log
        }
        ssdpClient = new ssdp(this.config.wemoClient.discover_opts)
      }

      // Setup successful
      this.log('%s. %s', platformLang.complete, platformLang.welcome)

      // Perform the first discovery run and set up the interval for subsequent runs
      this.discoverDevices()
      this.refreshInterval = setInterval(
        () => this.discoverDevices(),
        this.config.discoveryInterval * 1000,
      )
    } catch (err) {
      // Catch any errors during setup
      this.log.warn('***** %s. *****', platformLang.disabling)
      this.log.warn('***** %s. *****', parseError(err))
      this.pluginShutdown()
    }
  }

  pluginShutdown() {
    try {
      // Stop the discovery interval if it's running
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
      }

      // Shutdown the listener server if it's running
      if (listenerServer) {
        listenerServer.close(() => {
          if (this.config.debug) {
            this.log('%s.', platformLang.listenerClosed)
          }
        })
      }

      // Stop the SSDP client if it's running
      if (ssdpClient) {
        ssdpClient.stop()
        if (this.config.debug) {
          this.log('%s.', platformLang.ssdpStopped)
        }
      }

      // Close accessory subscriptions
      devicesInHB.forEach((accessory) => {
        if (accessory.control?.pollingInterval) {
          clearInterval(accessory.control.pollingInterval)
        }
        if (accessory.client) {
          accessory.client.stopSubscriptions()
        }
      })
    } catch (err) {
      // No need to show errors at this point
    }
  }

  async discoverDevices() {
    // Increment the discovery run count
    this.discoveryRun += 1
    const accessoryArray = [...devicesInHB.values()]

    // Nothing to do if mode is semi or manual and no device is re/awaiting connection
    if (
      this.config.mode !== 'auto'
      && existSerialsToConnect.length === 0
      && cacheSerialsToConnect.length === 0
    ) {
      return
    }

    // ********************* \\
    // Auto Detected Devices \\
    // ********************* \\
    if (
      this.config.mode === 'auto'
      || (this.config.mode === 'semi'
      && (cacheSerialsToConnect.length > 0 || existSerialsToConnect.length > 0))
    ) {
      // Remove all previous listeners as we don't want duplications on each interval
      ssdpClient.removeAllListeners('response')

      // Set up the listener for a detected device
      ssdpClient.on('response', async (msg) => {
        // Don't continue if it's not a Wemo device (service type)
        if (msg.ST !== 'urn:Belkin:service:basicevent:1') {
          return
        }

        // Get some information from the USN and location for checks
        const urlParts = new url(msg.LOCATION)
        const usnParts = msg.USN.split('::')
        const deviceIP = urlParts.hostname
        const devicePort = urlParts.port
        const deviceUDN = usnParts[0]
        try {
          // Checks for if the device is manually configured or if the device is ignored
          if (
            this.manualDevices.some(el => el.includes(deviceIP))
            || this.ignoredDevices.some(el => deviceUDN.toUpperCase().includes(el))
          ) {
            return
          }

          const deviceData = await this.getDeviceInfo(deviceIP, devicePort)

          // Don't continue if we haven't found the correct port
          if (!deviceData) {
            throw new Error(platformLang.noPort)
          }

          // Don't continue specifically if the device type is switch: https://bit.ly/hb-pywemo-link
          if (deviceData.deviceType === 'urn:Belkin:device:switch:1') {
            return
          }

          // Don't continue if the mode is semi, and it's not a configured device
          if (this.config.mode === 'semi' && !this.deviceConf[deviceData.serialNumber]) {
            return
          }

          // Find a matching Homebridge accessory
          const accessory = accessoryArray.find(el => el.context.udn === deviceUDN)

          // Check if the accessory exists
          if (accessory?.context?.initialised) {
            if (
              !existSerialsToConnect.includes(accessory.context.serialNumber)
              || !accessory.client
            ) {
              // Accessory exists and client has reported no error, nothing to do
              return
            }
            // Accessory exists but client has failed so renew
            this.reinitialiseDevice(accessory, deviceData)
          } else {
            // Accessory does not exist in Homebridge
            await this.initialiseDevice(deviceData)
          }
        } catch (err) {
          // Show warnings on runs 0 (initial), 2, 5, 8, 11, ... just to limit logging to an extent
          if (
            !this.config.hideConnectionErrors
            && (this.discoveryRun === 0 || this.discoveryRun % 3 === 2)
          ) {
            const eText = parseError(err, [platformLang.noPort])
            this.log.warn('[%s] %s: %s.', deviceIP, platformLang.connError, eText)
          }
        }
      })

      // Perform the scan
      try {
        await ssdpClient.search('urn:Belkin:service:basicevent:1')
      } catch (err) {
        const eText = err.message === 'No sockets available, cannot start.'
          ? platformLang.noSockets
          : parseError(err)
        this.log.warn('%s %s.', platformLang.ssdpFail, eText)
      }
    }

    // *************************** \\
    // Manually Configured Devices \\
    // *************************** \\
    this.manualDevices.forEach(async (device) => {
      try {
        // Check to see if the entry is a full address or an IP
        let deviceIP
        let devicePort
        if (device.includes(':')) {
          // It's a full address so get some information from the address
          const urlParts = new url(device)
          deviceIP = urlParts.hostname
          devicePort = urlParts.port
        } else {
          // It's an IP so perform a port scan
          deviceIP = device
          devicePort = null
        }
        const deviceData = await this.getDeviceInfo(deviceIP, devicePort)

        // Don't continue if no port was found
        if (!deviceData) {
          throw new Error(platformLang.noPort)
        }

        // Don't continue if the device is on the 'ignore list'
        if (this.ignoredDevices.includes(deviceData.serialNumber.toUpperCase())) {
          return
        }

        // Find a matching Homebridge accessory
        const accessory = accessoryArray.find(el => el.context.udn === deviceData.UDN)

        // Check if the accessory exists
        if (accessory?.context?.initialised) {
          if (
            !existSerialsToConnect.includes(accessory.context.serialNumber)
            || !accessory.client
          ) {
            // Accessory exists and client has reported no error, nothing to do
            return
          }
          // Accessory exists but client has failed so renew
          this.reinitialiseDevice(accessory, deviceData)
        } else {
          // Accessory does not exist in Homebridge
          await this.initialiseDevice(deviceData)
        }
      } catch (err) {
        // Show warnings on runs 0 (initial), 2, 5, 8, 11, ... just to limit logging to an extent
        if (
          !this.config.hideConnectionErrors
          && (this.discoveryRun === 0 || this.discoveryRun % 3 === 2)
        ) {
          const eText = parseError(err, [platformLang.noPort])
          this.log.warn('[%s] %s: %s.', device, platformLang.connError, eText)
        }
      }
    })

    // ************************ \\
    // Erroneous Device Logging \\
    // ************************ \\
    if (this.discoveryRun % 3 === 2) {
      // Add a small delay in case devices were discovered on this round
      setTimeout(() => {
        if (cacheSerialsToConnect.length > 0) {
          const names = accessoryArray.filter(el => cacheSerialsToConnect.includes(el.context.serialNumber))
          if (names.length > 0 && !this.config.hideConnectionErrors) {
            this.log.warn(
              '%s: [%s].',
              platformLang.awaiting,
              names.map(el => el.displayName).join('], ['),
            )
          }
        }
      }, 3000)
    }

    // Reset the discovery counter to 0
    if (this.discoveryRun === 3) {
      this.discoveryRun = 0
    }
  }

  async getDeviceInfo(thisIp, portToTryFirst) {
    // Try to find the correct port of a device by ip
    // Credit to @Zacknetic for this function
    const tryPort = async (port, ipAddress) => {
      try {
        // Send a request to the device URL to get the XML information
        const res = await axios.get(`http://${ipAddress}:${port}/setup.xml`, {
          timeout: 5000,
        })

        // Parse the XML response from the device
        const json = await parseStringPromise(res.data, { explicitArray: false })
        const { device } = json.root

        // Add extra properties to the device variable
        device.host = ipAddress
        device.port = port
        device.cbURL = this.config.callbackOverride
        || `${this.getLocalInterfaceAddress(ipAddress)}:${listenerServer.address().port}`

        // Return the XML2JS data
        return device
      } catch (err) {
        // Suppress any errors as we don't want to show them
        return false
      }
    }

    // Loop through the ports that Wemo devices generally use
    let portsToTry = platformConsts.portsToScan
    if (portToTryFirst) {
      portsToTry = portsToTry.filter(el => el !== portToTryFirst)
      portsToTry.unshift(portToTryFirst)
    }

    for (const port of portsToTry) {
      const portAttempt = await tryPort(port, thisIp)
      if (portAttempt) {
        // We found the correct port
        return portAttempt
      }
    }

    // None of the ports worked
    return false
  }

  applyAccessoryLogging(accessory) {
    if (this.isBeta) {
      accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
      accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
      accessory.logDebug = msg => this.log('[%s] %s.', accessory.displayName, msg)
      accessory.logDebugWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
    } else {
      if (this.config.disableDeviceLogging) {
        accessory.log = () => {}
        accessory.logWarn = () => {}
      } else {
        accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
        accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
      }
      accessory.logDebug = () => {}
      accessory.logDebugWarn = () => {}
    }
  }

  async initialiseDevice(device) {
    try {
      let accessory

      // Generate the uuid for this device from the device UDN
      const uuid = this.api.hap.uuid.generate(device.UDN)

      // Remove the device from the pending connection list
      cacheSerialsToConnect = cacheSerialsToConnect.filter(el => el !== device.serialNumber)

      // Obtain any user configured entry for this device
      const deviceConf = this.deviceConf[device.serialNumber] || {}

      // Save context information for the plugin to use
      const listenerType = deviceConf.listenerType === 'http' ? 'http' : 'upnp'
      const disableUPNP = this.config.disableUPNP ? 'http' : 'upnp'
      const context = {
        connection: deviceConf.listenerType ? listenerType : disableUPNP,
        cbURL: device.cbURL,
        firmware: device.firmwareVersion,
        hidden: false,
        icon: device.iconList?.icon?.url || false,
        ipAddress: device.host,
        macAddress: device.macAddress ? device.macAddress.replace(/..\B/g, '$&:') : false,
        port: device.port,
        serialNumber: device.serialNumber,
        udn: device.UDN,
      }

      // Create a map of device services
      const services = {}
      if (device.serviceList) {
        if (!Array.isArray(device.serviceList.service)) {
          device.serviceList.service = [device.serviceList.service]
        }
        // Put all the useful service info into the services object
        device.serviceList.service.forEach((service) => {
          services[service.serviceType] = {
            serviceId: service.serviceId,
            controlURL: service.controlURL,
            eventSubURL: service.eventSubURL,
          }
        })
      } else {
        // Device has no services so is useless to Homebridge
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }
        throw new Error(platformLang.noServices)
      }

      // Update the context with the service object
      context.serviceList = { ...services }

      // Get the correct device type instance
      switch (device.deviceType) {
        case 'urn:Belkin:device:bridge:1': {
          /**
           ***************
          WEMO LINKS * BULBS
           ****************
           */
          if (!context.serviceList['urn:Belkin:service:bridge:1']) {
            throw new Error(platformLang.noService)
          }

          // Set up the main 'hidden' accessory for the Link
          accessory = this.addAccessory(device, true, true)
          this.applyAccessoryLogging(accessory)
          accessory.context = { ...accessory.context, ...context, ...{ hidden: true } }
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceLinkHub(this, accessory, devicesInHB)

          // Request a list of subdevices from the Wemo Link
          const xml = xmlCreate('s:Envelope', {
            version: '1.0',
            encoding: 'utf-8',
            allowEmpty: true,
          })
            .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
            .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
            .ele('s:Body')
            .ele('u:GetEndDevices')
            .att('xmlns:u', 'urn:Belkin:service:bridge:1')

          // Send the request to the device
          const res = await axios({
            url: `http://${device.host}:${device.port}/upnp/control/bridge1`,
            method: 'post',
            headers: {
              'SOAPACTION': '"urn:Belkin:service:bridge:1#GetEndDevices"',
              'Content-Type': 'text/xml; charset="utf-8"',
            },
            data: xml.ele({ DevUDN: device.UDN, ReqListType: 'PAIRED_LIST' }).end(),
            timeout: 10000,
          })

          // Parse the response from the device
          const xmlRes = res.data
          const response = await parseStringPromise(xmlRes, { explicitArray: false })

          // Get the data we need the parsed response
          const data = response['s:Envelope']['s:Body']['u:GetEndDevicesResponse']

          // Parse the XML response from the Wemo Link
          const result = await parseStringPromise(data.DeviceLists)

          // A function used later for parsing the device information
          const parseDeviceInfo = (thisData) => {
            const thisDevice = {}
            if (thisData.GroupID) {
              // Treat device group as if it were a single device
              thisDevice.friendlyName = thisData.GroupName[0]
              thisDevice.deviceId = thisData.GroupID[0]
              const values = thisData.GroupCapabilityValues[0].split(',')
              thisDevice.capabilities = {}
              thisData.GroupCapabilityIDs[0].split(',').forEach((val, index) => {
                thisDevice.capabilities[val] = values[index]
              })
            } else {
              // Single device
              thisDevice.friendlyName = thisData.FriendlyName[0]
              thisDevice.deviceId = thisData.DeviceID[0]
              const values = thisData.CurrentState[0].split(',')
              thisDevice.capabilities = {}
              thisData.CapabilityIDs[0].split(',').forEach((val, index) => {
                thisDevice.capabilities[val] = values[index]
              })
            }
            return thisDevice
          }

          // Create an array of subdevices we can use
          const subdevices = []
          const deviceInfos = result.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo
          if (deviceInfos) {
            Array.prototype.push.apply(subdevices, deviceInfos.map(parseDeviceInfo))
          }
          if (result.DeviceLists.DeviceList[0].GroupInfos) {
            const groupInfos = result.DeviceLists.DeviceList[0].GroupInfos[0].GroupInfo
            Array.prototype.push.apply(subdevices, groupInfos.map(parseDeviceInfo))
          }

          // Loop through the subdevices initialising each one
          subdevices.forEach((subdevice) => {
            try {
              // Don't continue if the device is on the 'ignore list'
              if (this.ignoredDevices.includes(subdevice.deviceId.toUpperCase())) {
                return
              }

              // Give the subdevice some extra context (primary, secondary serial numbers)
              const extraContext = {
                capabilities: subdevice.capabilities,
                linkSerialNumber: device.serialNumber,
                serialNumber: subdevice.deviceId,
              }

              // Generate the uuid for this subdevice from the subdevice id
              const uuidSub = this.api.hap.uuid.generate(subdevice.deviceId)

              // Get the cached accessory or add to Homebridge if it doesn't exist
              const subAcc = devicesInHB.get(uuidSub) || this.addAccessory(subdevice)
              subAcc.context = { ...subAcc.context, ...context, ...extraContext }
              this.applyAccessoryLogging(subAcc)
              subAcc.control = new deviceTypes.deviceLinkBulb(this, accessory, subAcc)

              // Log the successfully initialised device
              this.log(
                '[%s] %s %s %s %s:%s.',
                subAcc.displayName,
                platformLang.initSer,
                subdevice.deviceId,
                platformLang.initMac,
                subAcc.context.ipAddress,
                subAcc.context.port,
              )

              // Mark the device as initialised and the http status as online
              subAcc.context.initialised = true
              subAcc.context.httpOnline = true
              if (context.connection === 'upnp') {
                subAcc.context.upnpOnline = true
              }

              // Update any changes to the accessory to the platform
              this.api.updatePlatformAccessories([subAcc])
              devicesInHB.set(uuidSub, subAcc)
            } catch (err) {
              // Catch any errors during the process
              const eText = parseError(err)
              this.log.warn('[%s] %s %s.', subdevice.friendlyName, platformLang.devNotInit, eText)
            }
          })
          break
          /** */
        }
        case 'urn:Belkin:device:insight:1': {
          /**
           **********
          WEMO INSIGHTS
           ***********
           */
          // Retrieve or add accessory, and add client and control properties
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          const showAs = deviceConf.showAs || platformConsts.defaultValues.showAs
          switch (showAs) {
            case 'purifier':
              accessory.control = new deviceTypes.deviceSimPurifierInsight(this, accessory)
              break
            case 'switch':
              accessory.control = new deviceTypes.deviceSimSwitchInsight(this, accessory)
              break
            default:
              accessory.control = new deviceTypes.deviceInsight(this, accessory)
              break
          }
          break
          /** */
        }
        case 'urn:Belkin:device:dimmer:1': {
          /**
           *********
          WEMO DIMMERS
           **********
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceDimmer(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:lightswitch:1': {
          /**
           ****************
          WEMO LIGHT SWITCHES
           *****************
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceLightSwitch(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:Maker:1': {
          /**
           ********
          WEMO MAKERS
           *********
           */
          // Retrieve or add accessory, and add client and control properties
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          if (deviceConf.showAsGarage) {
            accessory.control = new deviceTypes.deviceMakerGarage(this, accessory)
          } else {
            accessory.control = new deviceTypes.deviceMakerSwitch(this, accessory)
          }
          break
          /** */
        }
        case 'urn:Belkin:device:sensor:1':
        case 'urn:Belkin:device:NetCamSensor:1': {
          /**
           *********
          WEMO MOTIONS
           **********
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceMotion(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:controllee:1':
        case 'urn:Belkin:device:outdoor:1': {
          /**
           **********
          WEMO SWITCHES
           ***********
           */
          // Retrieve or add accessory, and add client and control properties
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }

          const showAs = deviceConf.showAs || platformConsts.defaultValues.showAs
          switch (showAs) {
            case 'purifier':
              accessory.control = new deviceTypes.deviceSimPurifier(this, accessory)
              break
            case 'switch':
              accessory.control = new deviceTypes.deviceSimSwitch(this, accessory)
              break
            default:
              accessory.control = new deviceTypes.deviceOutlet(this, accessory)
              break
          }
          break
          /** */
        }
        case 'urn:Belkin:device:HeaterA:1':
        case 'urn:Belkin:device:HeaterB:1': {
          /**
           *********
          WEMO HEATERS
           **********
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceHeater(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:Humidifier:1':
        case 'urn:Belkin:device:HumidifierB:1': {
          /**
           *************
          WEMO HUMIDIFIERS
           **************
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceHumidifier(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:AirPurifier:1': {
          /**
           ***********
          WEMO PURIFIERS
           ************
           */
          if (deviceConf.label) {
            device.friendlyName = deviceConf.label
          }
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.devicePurifier(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:crockpot:1': {
          /**
           ***********
          WEMO CROCKPOTS
           ************
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)

          // Wemo Crockpot does not support UPnP so override the connection to http
          accessory.context = { ...accessory.context, ...context, ...{ connection: 'http' } }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceCrockpot(this, accessory)
          break
          /** */
        }
        case 'urn:Belkin:device:CoffeeMaker:1': {
          /**
           ***************
          WEMO COFFEE MAKERS
           ****************
           */
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)
          accessory.context = { ...accessory.context, ...context }
          this.applyAccessoryLogging(accessory)
          if (Object.keys(context.serviceList).length > 0 && context.connection === 'upnp') {
            accessory.client = new upnpClient(this, accessory)
          }
          accessory.control = new deviceTypes.deviceCoffee(this, accessory)
          break
          /** */
        }
        default: {
          /**
           **************
          UNSUPPORTED AS YET
           ***************
           */
          this.log.warn(
            '[%s] [%s] %s.',
            device.friendlyName,
            device.deviceType,
            platformLang.unsupported,
          )

          // Add device to ignore list to stop repeated notifications
          this.ignoredDevices.push(device.serialNumber.toUpperCase())
          return
          /** */
        }
      }

      // Log the successfully initialised device
      this.log(
        '[%s] %s %s %s %s:%s',
        accessory.displayName,
        platformLang.initSer,
        device.serialNumber,
        platformLang.initMac,
        accessory.context.ipAddress,
        accessory.context.port,
      )

      // Mark the device as initialised and the http status as online
      accessory.context.initialised = true
      accessory.context.httpOnline = true
      accessory.log(platformLang.httpGood)

      // If upnp is enabled then start the subscriptions as mark the upnp status as online
      if (accessory.client) {
        accessory.client.startSubscriptions()
        accessory.context.upnpOnline = true
        accessory.log(platformLang.upnpGood)
      }

      // Update any changes to the accessory to the platform
      this.api.updatePlatformAccessories([accessory])
      devicesInHB.set(uuid, accessory)
    } catch (err) {
      // Catch any errors during the process
      this.log.warn('[%s] %s %s.', device.friendlyName, platformLang.devNotInit, parseError(err))
    }
  }

  addAccessory(device, isPri, hidden = false) {
    const accName = device.friendlyName || device.deviceId || device.serialNumber
    try {
      // Add an accessory to Homebridge
      const newUUID = this.api.hap.uuid.generate(isPri ? device.UDN : device.deviceId)
      const accessory = new this.api.platformAccessory(accName, newUUID)

      // If it isn't a hidden device then set the accessory characteristics
      if (!hidden) {
        accessory
          .getService(this.api.hap.Service.AccessoryInformation)
          .setCharacteristic(this.api.hap.Characteristic.Name, accName)
          .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, accName)
          .setCharacteristic(this.api.hap.Characteristic.Manufacturer, platformLang.brand)
          .setCharacteristic(
            this.api.hap.Characteristic.Model,
            isPri ? device.modelName : platformLang.modelLED,
          )
          .setCharacteristic(
            this.api.hap.Characteristic.SerialNumber,
            isPri ? device.serialNumber : device.deviceId,
          )
          .setCharacteristic(this.api.hap.Characteristic.Identify, true)

        // Register the accessory if it hasn't been hidden by the user
        this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
        this.log('[%s] %s.', accName, platformLang.devAdd)
      }
      this.configureAccessory(accessory)
      return accessory
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', accName, platformLang.devNotAdd, parseError(err))
      return false
    }
  }

  configureAccessory(accessory) {
    // Add the configured accessory to our global map
    devicesInHB.set(accessory.UUID, accessory)
  }

  removeAccessory(accessory) {
    try {
      // Remove an accessory from Homebridge
      if (!accessory.context.hidden) {
        this.api.unregisterPlatformAccessories(plugin.name, plugin.alias, [accessory])
      }
      devicesInHB.delete(accessory.UUID)
      this.log('[%s] %s.', accessory.displayName, platformLang.devRemove)
    } catch (err) {
      // Catch any errors during remove
      this.log.warn('[%s] %s %s.', accessory.displayName, platformLang.devNotRemove, parseError(err))
    }
  }

  reinitialiseDevice(accessory, deviceData) {
    // Update the context with the new information
    accessory.context = {
      ...accessory.context,
      ...{
        cbURL: deviceData.cbURL,
        controllable: true,
        ipAddress: deviceData.host,
        port: deviceData.port,
      },
    }

    // Mark the http status as online
    accessory.context.httpOnline = true
    accessory.log(platformLang.httpGood)

    // If upnp is supported then restart subscriptions and mark the upnp status as online
    if (accessory.client) {
      accessory.client.startSubscriptions()
      accessory.context.upnpOnline = true
      accessory.log(platformLang.upnpGood)
    }

    // Remove the accessory from the pending connection list
    existSerialsToConnect = existSerialsToConnect.filter(el => el !== deviceData.serialNumber)
    this.api.updatePlatformAccessories([accessory])
    devicesInHB.set(accessory.UUID, accessory)
  }

  disableUPNP(accessory, err) {
    // Log the error immediately
    if (accessory.context.enableLogging) {
      accessory.logWarn(`${platformLang.upnpFail} [${err.message}]`)
    }

    // Update the context now the device is uncontrollable
    accessory.context.upnpOnline = false
    existSerialsToConnect.push(accessory.context.serialNumber)

    // Update any changes to the accessory to the platform
    this.api.updatePlatformAccessories([accessory])
    devicesInHB.set(accessory.UUID, accessory)

    // Perform a http poll to see if the device is still reachable
    if (accessory.control?.requestDeviceUpdate) {
      // Above checks as example the wemo motion does not have this function
      accessory.control.requestDeviceUpdate()
    }
  }

  updateHTTPStatus(accessory, newStatus) {
    if (newStatus) {
      // Mark the http status as online
      accessory.log(platformLang.httpGood)
      accessory.context.httpOnline = true

      // If upnp is disabled then remove the device from the needs to be reinitialised
      if (accessory.context.connection === 'http') {
        existSerialsToConnect = existSerialsToConnect.filter(
          el => el !== accessory.context.serialNumber,
        )
      }
    } else {
      // Mark the http status as offline
      accessory.logWarn(platformLang.httpFail)
      accessory.context.httpOnline = false

      // If upnp is disabled then mark the accessory as needs to be reinitialised
      if (accessory.context.connection === 'http') {
        existSerialsToConnect.push(accessory.context.serialNumber)
      }
    }

    // Update any changes to the accessory to the platform
    this.api.updatePlatformAccessories([accessory])
    devicesInHB.set(accessory.UUID, accessory)
  }

  getLocalInterfaceAddress(targetNetwork) {
    // Get a list of available network interfaces
    let interfaces = networkInterfaces()

    // Check if the user has specified a network interface to listen on
    if (this.config.wemoClient.listen_interface) {
      // Specific interface in config, so check it exists in list
      if (interfaces[this.config.wemoClient.listen_interface]) {
        // Filter the interfaces object down to the specific interface
        interfaces = [interfaces[this.config.wemoClient.listen_interface]]
      } else {
        // Specified interface doesn't exist
        throw new Error(
          `${platformLang.noInterface} [${this.config.wemoClient.listen_interface}]`,
        )
      }
    }

    // Get an appropriate IP address for the system
    const addresses = []
    Object.entries(interfaces).forEach((entry) => {
      const [k] = entry
      Object.entries(interfaces[k]).forEach((subEntry) => {
        const [k2] = subEntry
        const address = interfaces[k][k2]
        if ((address.family === 'IPv4' || address.family === 4) && !address.internal) {
          if (targetNetwork && ip.subnet(address.address, address.netmask).contains(targetNetwork)) {
            // Try to find IP address on the same IP network as the device's location
            addresses.unshift(address.address)
          } else {
            addresses.push(address.address)
          }
        }
      })
    })

    // Return the IP address
    return addresses.shift()
  }
}
