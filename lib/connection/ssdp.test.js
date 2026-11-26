import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import SsdpDiscovery, { discoveryOptions, parseHeaders, searchMessage, SSDP_ADDRESS, SSDP_PORT } from './ssdp.js'

const WEMO = 'urn:Belkin:service:basicevent:1'

// What a Wemo Mini answers to a search, captured from a real device
const WEMO_REPLY = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age=86400',
  'DATE: Wed, 26 Nov 2026 10:00:00 GMT',
  'EXT:',
  'LOCATION: http://192.168.1.50:49153/setup.xml',
  'OPT: "http://schemas.upnp.org/upnp/1/0/"; ns=01',
  '01-NLS: 905bfa3c-1dd2-11b2-8928-fd8aebaf491c',
  'SERVER: Unspecified, UPnP/1.0, Unspecified',
  'X-User-Agent: redsonic',
  `ST: ${WEMO}`,
  `USN: uuid:Socket-1_0-221234K0101234::${WEMO}`,
  '',
  '',
].join('\r\n')

const interfaces = {
  lo0: [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
  ],
  eth0: [
    { address: '192.168.1.10', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
  eth: [
    { address: '10.0.0.10', family: 'IPv4', internal: false },
  ],
}

/** A stand-in for a dgram socket, which binds at once unless told to fail. */
function fakeSocketFactory({ failBind = [] } = {}) {
  const sockets = []
  const createSocket = vi.fn(() => {
    const socket = new EventEmitter()
    socket.sent = []
    socket.bind = vi.fn(({ address }, callback) => {
      socket.boundTo = address
      if (failBind.includes(address)) {
        queueMicrotask(() => socket.emit('error', new Error('bind EADDRNOTAVAIL')))
      } else {
        queueMicrotask(callback)
      }
    })
    socket.setMulticastTTL = vi.fn()
    socket.setMulticastInterface = vi.fn()
    socket.unref = vi.fn()
    socket.address = () => ({ port: 50000 + sockets.length })
    socket.send = vi.fn((buffer, offset, length, port, address) => socket.sent.push({
      text: buffer.toString(),
      port,
      address,
    }))
    socket.close = vi.fn()
    sockets.push(socket)
    return socket
  })
  return { sockets, createSocket }
}

describe('the search request and the answers', () => {
  it('asks the ssdp group for one service type', () => {
    expect(searchMessage(WEMO).toString()).toBe([
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      `ST: ${WEMO}`,
      'MAN: "ssdp:discover"',
      'MX: 3',
      '',
      '',
    ].join('\r\n'))
  })

  it('reads the headers of a wemo answer with the names in capitals', () => {
    const headers = parseHeaders(WEMO_REPLY)
    expect(headers.ST).toBe(WEMO)
    expect(headers.LOCATION).toBe('http://192.168.1.50:49153/setup.xml')
    expect(headers.USN).toBe(`uuid:Socket-1_0-221234K0101234::${WEMO}`)
    expect(headers['X-USER-AGENT']).toBe('redsonic')
    expect(headers.EXT).toBe('')
  })
})

describe('searching for wemo devices', () => {
  it('opens a socket per ipv4 address outside this machine, on a random port', async () => {
    const { sockets, createSocket } = fakeSocketFactory()
    const client = new SsdpDiscovery({
      networkInterfaces: () => interfaces,
      createSocket,
    })

    await client.search(WEMO)

    expect(sockets.map(s => s.boundTo)).toEqual(['192.168.1.10', '10.0.0.10'])
    for (const socket of sockets) {
      expect(socket.bind.mock.calls[0][0].port).toBe(0)
      expect(socket.sent).toEqual([
        {
          text: searchMessage(WEMO).toString(),
          port: SSDP_PORT,
          address: SSDP_ADDRESS,
        },
      ])
    }
  })

  it('uses only the named interfaces, matching whole names', async () => {
    const { sockets, createSocket } = fakeSocketFactory()
    const client = new SsdpDiscovery({
      interfaces: ['eth0'],
      networkInterfaces: () => interfaces,
      createSocket,
    })

    await client.search(WEMO)

    expect(sockets.map(s => s.boundTo)).toEqual(['192.168.1.10'])
  })

  it('leaves the address to the system without an explicit bind', async () => {
    const { sockets, createSocket } = fakeSocketFactory()
    const client = new SsdpDiscovery({
      interfaces: ['eth0'],
      explicitSocketBind: false,
      networkInterfaces: () => interfaces,
      createSocket,
    })

    await client.search(WEMO)

    expect(sockets[0].boundTo).toBeUndefined()
    expect(sockets[0].setMulticastInterface).toHaveBeenCalledWith('192.168.1.10')
  })

  it('opens the sockets once, and searches every time', async () => {
    const { sockets, createSocket } = fakeSocketFactory()
    const client = new SsdpDiscovery({
      interfaces: ['eth0'],
      networkInterfaces: () => interfaces,
      createSocket,
    })

    await Promise.all([
      client.search(WEMO),
      client.search(WEMO),
    ])
    await client.search(WEMO)

    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(sockets[0].sent).toHaveLength(3)
  })

  it('skips an address it cannot use and searches from the others', async () => {
    const { sockets, createSocket } = fakeSocketFactory({
      failBind: ['10.0.0.10'],
    })
    const logger = vi.fn()
    const client = new SsdpDiscovery({
      networkInterfaces: () => interfaces,
      createSocket,
      logger,
    })

    await client.search(WEMO)

    expect(sockets[0].sent).toHaveLength(1)
    expect(sockets[1].close).toHaveBeenCalled()
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('could not use'), 'eth', '10.0.0.10', 'bind EADDRNOTAVAIL')
  })

  it('reports a start with no usable network, and tries again on the next search', async () => {
    const { createSocket } = fakeSocketFactory()
    let current = {}
    const client = new SsdpDiscovery({
      networkInterfaces: () => current,
      createSocket,
    })

    await expect(client.search(WEMO)).rejects.toThrow('no network interface with an IPv4 address')

    // the network comes up after Homebridge started
    current = interfaces
    await expect(client.search(WEMO)).resolves.toBeUndefined()
    expect(client.sockets.size).toBe(2)
  })

  it('passes each answer on, and ignores other devices\' searches and announcements', async () => {
    const { sockets, createSocket } = fakeSocketFactory()
    const client = new SsdpDiscovery({
      interfaces: ['eth0'],
      networkInterfaces: () => interfaces,
      createSocket,
    })
    const listener = vi.fn()
    client.on('response', listener)
    await client.search(WEMO)

    const rinfo = { address: '192.168.1.50', port: 1900 }
    sockets[0].emit('message', Buffer.from(WEMO_REPLY), rinfo)
    sockets[0].emit('message', Buffer.from('NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\n\r\n'), rinfo)
    sockets[0].emit('message', Buffer.from(searchMessage(WEMO)), rinfo)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].LOCATION).toBe('http://192.168.1.50:49153/setup.xml')
    expect(listener.mock.calls[0][1]).toBe(200)
    expect(listener.mock.calls[0][2]).toBe(rinfo)
  })

  it('closes the sockets on stop, and opens new ones on the next search', async () => {
    const { sockets, createSocket } = fakeSocketFactory()
    const client = new SsdpDiscovery({
      interfaces: ['eth0'],
      networkInterfaces: () => interfaces,
      createSocket,
    })
    await client.search(WEMO)

    client.stop()
    expect(sockets[0].close).toHaveBeenCalled()

    await client.search(WEMO)
    expect(createSocket).toHaveBeenCalledTimes(2)
  })
})

describe('on real sockets', () => {
  const opened = []
  afterEach(() => {
    while (opened.length) {
      opened.pop().close()
    }
  })

  const loopbackOnly = () => ({
    test: [
      { address: '127.0.0.1', family: 'IPv4', internal: false },
    ],
  })

  it('starts while another program holds udp port 1900 (#295)', async () => {
    // node-ssdp 5 and 6 also listened on the ssdp port itself, so a host where
    // another program had 1900 (docker host networking) never searched
    const blocker = dgram.createSocket({ type: 'udp4', reuseAddr: false })
    await new Promise((resolve) => {
      blocker.once('error', resolve)
      blocker.bind({
        port: 1900,
        exclusive: true,
      }, resolve)
    })
    opened.push(blocker)
    const client = new SsdpDiscovery({
      interfaces: ['test'],
      networkInterfaces: loopbackOnly,
    })
    opened.push({
      close: () => client.stop(),
    })

    await expect(client.start()).resolves.toBeUndefined()
    expect(client.sockets.size).toBe(1)
    expect(client.sockets.get('127.0.0.1').address().port).not.toBe(1900)
  })

  it('receives a device\'s answer sent back to the search port', async () => {
    const client = new SsdpDiscovery({
      interfaces: ['test'],
      networkInterfaces: loopbackOnly,
    })
    opened.push({
      close: () => client.stop(),
    })
    await client.start()
    const answered = new Promise(resolve => client.once('response', (...args) => resolve(args)))

    const device = dgram.createSocket('udp4')
    opened.push(device)
    device.send(WEMO_REPLY, client.sockets.get('127.0.0.1').address().port, '127.0.0.1')

    const [headers, statusCode, rinfo] = await answered
    expect(headers.ST).toBe(WEMO)
    expect(statusCode).toBe(200)
    expect(rinfo.address).toBe('127.0.0.1')
  })
})

describe('the options for the discovery client', () => {
  it('turns the comma separated interfaces into a list of names', () => {
    const logger = () => {}

    expect(discoveryOptions({ interfaces: 'eth0, wlan0', explicitSocketBind: true }, logger)).toEqual({
      interfaces: ['eth0', 'wlan0'],
      explicitSocketBind: true,
      logger,
    })
  })

  it('leaves the interfaces out when none are named, so every interface is used', () => {
    expect(discoveryOptions({ interfaces: '', explicitSocketBind: true }, () => {})).not.toHaveProperty('interfaces')
    expect(discoveryOptions(undefined, () => {})).not.toHaveProperty('interfaces')
  })

  it('binds explicitly unless the setting is turned off', () => {
    expect(discoveryOptions(undefined, () => {}).explicitSocketBind).toBe(true)
    expect(discoveryOptions({ explicitSocketBind: false }, () => {}).explicitSocketBind).toBe(false)
  })
})
