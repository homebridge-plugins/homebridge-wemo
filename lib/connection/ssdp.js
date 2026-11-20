/**
 * The options for the SSDP discovery client, from the plugin's `discover_opts`.
 *
 * `interfaces` is a comma separated string in the settings, and node-ssdp
 * wants a list of names. A string happened to work, as both have `indexOf`,
 * but `indexOf` on a string matches part of a name: `eth0` also picked `eth`.
 *
 * @param {object} options the `discover_opts` from the settings
 * @param {Function} logger where node-ssdp's own messages go
 */
export function discoveryOptions(options, logger) {
  const { interfaces, ...rest } = options || {}
  const names = typeof interfaces === 'string'
    ? interfaces.split(',').map(name => name.trim()).filter(Boolean)
    : []
  return {
    ...rest,
    ...(names.length > 0
      ? { interfaces: names }
      : {}),
    customLogger: logger,
  }
}

/**
 * Sends the searches for Wemo devices, starting the SSDP client once.
 *
 * node-ssdp 6 changed two things this needs:
 * - `search()` starts a client which is not started, and a start which fails
 *   no longer reaches the caller. It only prints a Node.js warning, so a
 *   machine with no usable network interface searched in silence. The client
 *   is started here first, so the plugin can say why discovery failed.
 * - `start()` on a client which is already started never finishes, so it is
 *   only called until it has worked once. A failed start closes the client's
 *   sockets, so the next search tries again.
 */
export default class SsdpDiscovery {
  constructor(client) {
    this.client = client
    this.started = false
  }

  async search(serviceType) {
    if (!this.started) {
      await this.client.start()
      this.started = true
    }
    this.client.search(serviceType)
  }

  on(event, listener) {
    this.client.on(event, listener)
    return this
  }

  removeAllListeners(event) {
    this.client.removeAllListeners(event)
    return this
  }

  stop() {
    this.started = false
    this.client.stop()
  }
}
