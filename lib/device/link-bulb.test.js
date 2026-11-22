import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hs2rgb, rgb2xy } from '../utils/colour.js'
import LinkBulb from './link-bulb.js'

/**
 * The first report after a restart, when adaptive lighting had asked for more
 * than the bulb can do.
 *
 * The bulb takes a colour temperature between 170 and 370 mireds, and is sent
 * the nearest it can do. HomeKit keeps what adaptive lighting asked for, so by
 * a restart in the evening HomeKit's value is somewhere the bulb never went,
 * and comparing the bulb's first report against it switched adaptive lighting
 * off. What was actually last sent is what counts.
 */

// Returns an object where any property read gives back its own name, so
// `Characteristic.Hue` is the string 'Hue'
function nameProxy() {
  return new Proxy({}, {
    get: (_target, prop) => (typeof prop === 'string'
      ? prop
      : undefined),
  })
}

function makeService() {
  const characteristics = new Map()
  const service = {
    getCharacteristic: (name) => {
      if (!characteristics.has(name)) {
        const characteristic = {
          value: name === 'ColorTemperature'
            ? 140
            : 0,
          // Kept so a test can call it the way HAP-NodeJS would
          onSet: (handler) => {
            characteristic.setHandler = handler
            return characteristic
          },
          removeOnSet: () => characteristic,
          setProps: () => characteristic,
        }
        characteristics.set(name, characteristic)
      }
      return characteristics.get(name)
    },
    updateCharacteristic: (name, value) => {
      service.getCharacteristic(name).value = value
      return service
    },
    testCharacteristic: name => characteristics.has(name),
    removeCharacteristic: () => {},
  }
  return service
}

function makeAccessory() {
  const service = makeService()
  return {
    displayName: 'Bulb',
    context: {
      serialNumber: 'bulb',
      capabilities: { 10006: '1', 10008: '1', 30301: '1' },
    },
    getService: () => service,
    addService: () => service,
    configureController: () => {},
    log: () => {},
    logWarn: () => {},
    logDebug: () => {},
    logDebugWarn: () => {},
  }
}

const platform = {
  api: {
    hap: {
      Characteristic: nameProxy(),
      Service: nameProxy(),
      HapStatusError: class extends Error {},
      AdaptiveLightingController: class {},
    },
  },
  deviceConf: {},
  log: () => {},
}

const priAcc = {
  control: {
    sendDeviceUpdate: async () => {},
    requestDeviceUpdate: async () => {
      throw new Error('not in a test')
    },
  },
}

describe('a link bulb restarted after adaptive lighting asked for more than it can do', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const mockController = () => ({
    isAdaptiveLightingActive: () => true,
    disableAdaptiveLighting: vi.fn(),
  })

  // Adaptive lighting asks for 400 mireds and the bulb is sent its warmest,
  // 370, while HomeKit keeps the 400. Then boot again on the same accessory,
  // the way Homebridge restores it from its cache
  async function restartAfterAdaptiveLightingWentWarmer() {
    const accessory = makeAccessory()
    const before = new LinkBulb(platform, priAcc, accessory)
    before.alController = mockController()
    accessory.getService().updateCharacteristic('ColorTemperature', 400)
    const sent = before.internalCTUpdate(400)
    await vi.advanceTimersByTimeAsync(1000)
    await sent

    const device = new LinkBulb(platform, priAcc, accessory)
    device.alController = mockController()
    return device
  }

  it('leaves adaptive lighting on when the bulb reports the colour temperature it was last sent', async () => {
    const device = await restartAfterAdaptiveLightingWentWarmer()

    device.externalCTUpdate(370)

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('still switches it off when the colour temperature was changed while homebridge was down', async () => {
    const device = await restartAfterAdaptiveLightingWentWarmer()

    device.externalCTUpdate(200)

    expect(device.alController.disableAdaptiveLighting).toHaveBeenCalledTimes(1)
  })
})

describe('a link bulb with its own settings in the config', () => {
  // The platform stores the id the hub gives the bulb as the serial number,
  // and the config is keyed on that id in upper case
  it('picks up its brightness step and adaptive lighting shift', () => {
    const accessory = makeAccessory()
    accessory.context.serialNumber = '94103ea2b27803ed'
    const configured = {
      ...platform,
      deviceConf: {
        '94103EA2B27803ED': { brightnessStep: 25, adaptiveLightingShift: 30 },
      },
    }

    const device = new LinkBulb(configured, priAcc, accessory)

    expect(device.brightStep).toBe(25)
    expect(device.alShift).toBe(30)
  })
})

describe('a colour link bulb when home sets hue and saturation together', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeColourBulb() {
    const accessory = makeAccessory()
    accessory.context.capabilities = {
      10006: '1',
      10008: '1',
      10300: '1',
      30301: '1',
    }
    const configured = {
      ...platform,
      deviceConf: {
        BULB: { enableColourControl: true, adaptiveLightingShift: -1 },
      },
    }
    const sent = []
    const recorder = {
      control: {
        ...priAcc.control,
        sendDeviceUpdate: async (_serial, capability, value) => {
          sent.push({ capability, value })
        },
      },
    }
    const device = new LinkBulb(configured, recorder, accessory)
    const colours = () => sent.filter(({ capability }) => capability === '10300').map(({ value }) => value)
    return { device, colours }
  }

  // Writes several characteristics the way HAP-NodeJS does for one HomeKit
  // request: every set handler starts at once, and a characteristic only takes
  // its new value once its own handler has finished
  async function homeWrites(device, pairs) {
    const done = Promise.all(pairs.map(async ([name, value]) => {
      const characteristic = device.service.getCharacteristic(name)
      await characteristic.setHandler(value)
      characteristic.value = value
    }))
    await vi.advanceTimersByTimeAsync(1000)
    await done
  }

  // The command the bulb should get for a hue and saturation
  function colourFor(hue, saturation) {
    const [x, y] = rgb2xy(...hs2rgb(hue, saturation))
    return `${Math.round(x * 65535)}:${Math.round(y * 65535)}:0`
  }

  it('sends the new colour once, not the one before', async () => {
    const { device, colours } = makeColourBulb()

    await homeWrites(device, [
      ['Hue', 240],
      ['Saturation', 100],
    ])
    expect(colours()).toEqual([
      colourFor(240, 100),
    ])

    // A scene turning the bulb orange, with the saturation written again
    await homeWrites(device, [
      ['Hue', 25],
      ['Saturation', 100],
    ])
    expect(colours()).toEqual([
      colourFor(240, 100),
      colourFor(25, 100),
    ])
  })

  it('sends the new saturation when home writes saturation first', async () => {
    const { device, colours } = makeColourBulb()

    await homeWrites(device, [
      ['Saturation', 50],
      ['Hue', 120],
    ])

    expect(colours()).toEqual([
      colourFor(120, 50),
    ])
  })

  it('keeps the hue the bulb reported when home then changes only the saturation', async () => {
    const { device, colours } = makeColourBulb()
    await homeWrites(device, [
      ['Hue', 240],
      ['Saturation', 100],
    ])

    // The bulb is turned red in the Wemo app
    const [x, y] = rgb2xy(255, 0, 0)
    device.externalColourUpdate(Math.round(x * 65535), Math.round(y * 65535))
    const reportedHue = device.service.getCharacteristic('Hue').value

    await homeWrites(device, [
      ['Saturation', 50],
    ])

    expect(colours()).toEqual([
      colourFor(240, 100),
      colourFor(reportedHue, 50),
    ])
  })
})
