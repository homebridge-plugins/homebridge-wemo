import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HttpClient from './http.js'

vi.mock('axios', () => ({
  default: vi.fn(),
}))

const SERVICE = 'urn:Belkin:service:basicevent:1'
const reply = '<s:Envelope><s:Body><u:SetBinaryStateResponse><BinaryState>1</BinaryState></u:SetBinaryStateResponse></s:Body></s:Envelope>'

function makeAccessory(ipAddress, port = 49153) {
  return {
    context: {
      ipAddress,
      port,
      httpOnline: true,
      serviceList: {
        [SERVICE]: { controlURL: '/upnp/control/basicevent1' },
      },
    },
  }
}

describe('sending updates to wemo devices', () => {
  let started

  beforeEach(() => {
    vi.useFakeTimers()
    started = []
    // Every device takes one second to answer
    axios.mockImplementation(async ({ url }) => {
      started.push({
        url,
        at: Date.now(),
      })
      await new Promise(resolve => setTimeout(resolve, 1000))
      return { data: reply }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    axios.mockReset()
  })

  it('does not make one device wait for a slow answer from another (#294)', async () => {
    const client = new HttpClient({
      updateHTTPStatus: vi.fn(),
    })
    const t0 = Date.now()

    // A scene switches four different Wemos at the same moment
    const devices = [
      '192.168.1.10',
      '192.168.1.11',
      '192.168.1.12',
      '192.168.1.13',
    ].map(ip => makeAccessory(ip))
    const sends = devices.map(acc => client.sendDeviceUpdate(acc, SERVICE, 'SetBinaryState', { BinaryState: 1 }))

    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all(sends)

    // Every request reaches its device straight away, so none of them gets near
    // Homebridge's three second 'slow to respond' warning
    expect(started).toHaveLength(4)
    for (const { at } of started) {
      expect(at - t0).toBeLessThan(100)
    }
  })

  it('still sends requests to the same device one at a time', async () => {
    const client = new HttpClient({
      updateHTTPStatus: vi.fn(),
    })
    const acc = makeAccessory('192.168.1.10')
    const t0 = Date.now()

    const sends = [1, 0].map(state => client.sendDeviceUpdate(acc, SERVICE, 'SetBinaryState', { BinaryState: state }))

    await vi.advanceTimersByTimeAsync(2500)
    await Promise.all(sends)

    expect(started).toHaveLength(2)
    expect(started[0].at - t0).toBeLessThan(100)
    expect(started[1].at - t0).toBeGreaterThanOrEqual(1000)
  })
})
