import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import os from 'node:os'

export const SSDP_ADDRESS = '239.255.255.250'
export const SSDP_PORT = 1900

/**
 * The options for the SSDP discovery client, from the plugin's `discover_opts`.
 *
 * `interfaces` is a comma separated string in the settings, and is turned into
 * a list of names here, so `eth0` matches only `eth0`, never part of a name.
 *
 * @param {object} options the `discover_opts` from the settings
 * @param {Function} logger where the client's own messages go
 */
export function discoveryOptions(options, logger) {
  const { interfaces, explicitSocketBind } = options || {}
  const names = typeof interfaces === 'string'
    ? interfaces.split(',').map(name => name.trim()).filter(Boolean)
    : []
  return {
    ...(names.length > 0
      ? { interfaces: names }
      : {}),
    explicitSocketBind: explicitSocketBind !== false,
    logger,
  }
}

/**
 * Reads the headers of an SSDP message, with the names in capitals, so a
 * device that sends `Location:` is read the same as one that sends `LOCATION:`.
 */
export function parseHeaders(message) {
  const headers = {}
  for (const line of message.split('\r\n').slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      headers[line.slice(0, colon).trim().toUpperCase()] = line.slice(colon + 1).trim()
    }
  }
  return headers
}

/** The search request for one service type, as the UPnP spec lays it out. */
export function searchMessage(serviceType) {
  return Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
    `ST: ${serviceType}`,
    'MAN: "ssdp:discover"',
    'MX: 3',
    '',
    '',
  ].join('\r\n'), 'ascii')
}

/**
 * Searches the network for Wemo devices with SSDP, and emits each device's
 * answer as a `response` event: (headers, statusCode, rinfo).
 *
 * Searching only needs to send a request to the SSDP group and read the
 * answers, which come back to the port the request was sent from. So each
 * socket here binds a random port, one per network address, and nothing
 * listens on udp port 1900. node-ssdp 5 and 6 did, and failed to start at
 * all when another program already had that port, which is common with
 * docker host networking (#295).
 */
export default class SsdpDiscovery extends EventEmitter {
  /**
   * @param {object} options
   * @param {string[]} [options.interfaces] names of the network interfaces to use, all when left out
   * @param {boolean} [options.explicitSocketBind] bind each socket to its interface's address
   * @param {Function} [options.logger] where debug messages go
   * @param {Function} [options.networkInterfaces] for tests
   * @param {Function} [options.createSocket] for tests
   */
  constructor({
    interfaces,
    explicitSocketBind = true,
    logger = () => {},
    networkInterfaces = os.networkInterfaces,
    createSocket = dgram.createSocket,
  } = {}) {
    super()
    this.interfaces = interfaces
    this.explicitSocketBind = explicitSocketBind
    this.logger = logger
    this.networkInterfaces = networkInterfaces
    this.createSocket = createSocket
    this.sockets = new Map()
    this.starting = null
  }

  /** The IPv4 addresses to search from, outside this machine itself. */
  addresses() {
    const found = []
    for (const [name, entries] of Object.entries(this.networkInterfaces() || {})) {
      if (this.interfaces && !this.interfaces.includes(name)) {
        continue
      }
      for (const entry of entries || []) {
        const ipv4 = entry.family === 'IPv4' || entry.family === 4
        if (ipv4 && !entry.internal) {
          found.push({ name, address: entry.address })
        }
      }
    }
    return found
  }

  /**
   * Opens a socket for every address. An address whose socket cannot be
   * opened is skipped with a debug message. With none open, the start fails
   * and the next search tries again, for example once the network is up.
   */
  async start() {
    const addresses = this.addresses()
    await Promise.all(addresses.map(({ name, address }) => this.open(name, address)))
    if (this.sockets.size === 0) {
      throw new Error(addresses.length === 0
        ? 'no network interface with an IPv4 address was found'
        : 'no network interface could be used')
    }
  }

  open(name, address) {
    return new Promise((resolve) => {
      const socket = this.createSocket({ type: 'udp4', reuseAddr: true })
      const onBindError = (err) => {
        this.logger('SSDP could not use %s (%s): %s', name, address, err.message)
        socket.close()
        resolve()
      }
      socket.once('error', onBindError)
      socket.on('message', (message, rinfo) => this.receive(message, rinfo))
      socket.bind({
        port: 0,
        address: this.explicitSocketBind ? address : undefined,
      }, () => {
        socket.removeListener('error', onBindError)
        socket.on('error', err => this.logger('SSDP socket error on %s: %s', address, err.message))
        try {
          socket.setMulticastTTL(4)
          // Without an explicit bind, still send through this interface
          socket.setMulticastInterface(address)
        } catch (err) {
          this.logger('SSDP could not set multicast options on %s: %s', address, err.message)
        }
        socket.unref()
        this.sockets.set(address, socket)
        this.logger('SSDP searching from %s (%s) on port %s', name, address, socket.address().port)
        resolve()
      })
    })
  }

  receive(message, rinfo) {
    const text = message.toString()
    const status = text.match(/^HTTP\/1\.[01] (\d{3})/i)
    // Only answers to a search are wanted, not other devices' own searches
    // or announcements
    if (!status) {
      return
    }
    this.emit('response', parseHeaders(text), Number(status[1]), rinfo)
  }

  async search(serviceType) {
    if (this.sockets.size === 0) {
      // A search made while the first start is still running waits for it
      this.starting ??= this.start().finally(() => {
        this.starting = null
      })
      await this.starting
    }
    const message = searchMessage(serviceType)
    for (const [address, socket] of this.sockets) {
      socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, (err) => {
        if (err) {
          this.logger('SSDP search from %s failed: %s', address, err.message)
        }
      })
    }
  }

  stop() {
    for (const socket of this.sockets.values()) {
      try {
        socket.close()
      } catch {
        // already closed
      }
    }
    this.sockets.clear()
  }
}
