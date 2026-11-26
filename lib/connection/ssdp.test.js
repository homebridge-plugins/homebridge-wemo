import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

import nodeSSDP from 'node-ssdp'
import { describe, expect, it, vi } from 'vitest'

import SsdpDiscovery, { discoveryOptions } from './ssdp.js'

/**
 * A stand-in for node-ssdp's client. Like the real one, a second start()
 * never finishes, and a failed start leaves it unstarted.
 */
function fakeClient({ failStarts = 0 } = {}) {
  const client = new EventEmitter()
  let started = false
  let failures = failStarts
  client.start = vi.fn(() => {
    if (started) {
      return new Promise(() => {})
    }
    if (failures > 0) {
      failures--
      return Promise.reject(new Error('No sockets available, cannot start.'))
    }
    started = true
    return Promise.resolve()
  })
  client.search = vi.fn()
  client.stop = vi.fn(() => {
    started = false
  })
  return client
}

describe('searching for wemo devices', () => {
  it('starts the client once, and searches every time', async () => {
    const client = fakeClient()
    const discovery = new SsdpDiscovery(client)

    // A second start() never finishes, so this would hang without the guard
    await discovery.search('urn:Belkin:service:basicevent:1')
    await discovery.search('urn:Belkin:service:basicevent:1')

    expect(client.start).toHaveBeenCalledTimes(1)
    expect(client.search).toHaveBeenCalledTimes(2)
  })

  it('reports a failed start, and starts again on the next search', async () => {
    const client = fakeClient({ failStarts: 1 })
    const discovery = new SsdpDiscovery(client)

    // node-ssdp's own search() would not report this failure
    await expect(discovery.search('urn:Belkin:service:basicevent:1')).rejects.toThrow('No sockets available')
    expect(client.search).not.toHaveBeenCalled()

    await discovery.search('urn:Belkin:service:basicevent:1')
    expect(client.start).toHaveBeenCalledTimes(2)
    expect(client.search).toHaveBeenCalledTimes(1)
  })

  it('starts again after it was stopped', async () => {
    const client = fakeClient()
    const discovery = new SsdpDiscovery(client)

    await discovery.search('urn:Belkin:service:basicevent:1')
    discovery.stop()
    await discovery.search('urn:Belkin:service:basicevent:1')

    expect(client.start).toHaveBeenCalledTimes(2)
  })

  it('passes the device answers through to the platform', async () => {
    const client = fakeClient()
    const discovery = new SsdpDiscovery(client)
    const listener = vi.fn()

    discovery.on('response', listener)
    client.emit('response', { ST: 'urn:Belkin:service:basicevent:1' })
    discovery.removeAllListeners('response')
    client.emit('response', {})

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('never hangs on the real client, which does not finish a second start', async () => {
    const { Client } = nodeSSDP
    const real = new Client({
      customLogger: () => {},
    })
    // The real start, short of binding sockets: a second call returns without calling back
    real._start = vi.fn(function (callback) {
      if (this._started) {
        return
      }
      this._started = true
      callback()
    })
    real.search = vi.fn()
    const discovery = new SsdpDiscovery(real)

    await discovery.search('urn:Belkin:service:basicevent:1')
    await discovery.search('urn:Belkin:service:basicevent:1')

    expect(real.search).toHaveBeenCalledTimes(2)
  })

  it('starts while another program holds udp port 1900 (#295)', async () => {
    // node-ssdp 6 also listened on the ssdp port itself, so a host where
    // another program had 1900 (docker host networking) never searched
    const blocker = dgram.createSocket({ type: 'udp4', reuseAddr: false })
    await new Promise((resolve) => {
      blocker.once('error', resolve)
      blocker.bind({ port: 1900, exclusive: true }, resolve)
    })
    const { Client } = nodeSSDP
    const real = new Client({
      customLogger: () => {},
    })
    vi.spyOn(real, 'search').mockImplementation(() => {})
    const discovery = new SsdpDiscovery(real)
    try {
      await expect(discovery.search('urn:Belkin:service:basicevent:1')).resolves.toBeUndefined()
      expect(real.search).toHaveBeenCalledTimes(1)
    } finally {
      discovery.stop()
      blocker.close()
    }
  })
})

describe('the options for the discovery client', () => {
  it('turns the comma separated interfaces into a list of names', () => {
    const logger = () => {}

    expect(discoveryOptions({ interfaces: 'eth0, wlan0', explicitSocketBind: true }, logger)).toEqual({
      interfaces: ['eth0', 'wlan0'],
      explicitSocketBind: true,
      customLogger: logger,
    })
  })

  it('leaves the interfaces out when none are named, so every interface is used', () => {
    expect(discoveryOptions({ interfaces: '', explicitSocketBind: true }, () => {})).not.toHaveProperty('interfaces')
    expect(discoveryOptions(undefined, () => {})).not.toHaveProperty('interfaces')
  })
})
