import { describe, expect, it } from 'vitest'

import Insight from './device/insight.js'
import PurifierInsight from './device/simulation/purifier-insight.js'
import SwitchInsight from './device/simulation/switch-insight.js'
import Platform from './platform.js'
import EveChars from './utils/eve-chars.js'

/**
 * Just enough of HAP to build the Eve characteristics and look at their props.
 * Real HAP rounds a uint16 value, so 5.49W is published as 5W - the props are
 * what decide that, so the props are what these tests check.
 */
class FakeCharacteristic {
  constructor(displayName, UUID, props = {}) {
    this.displayName = displayName
    this.UUID = UUID
    this.props = { ...props }
  }

  setProps(props) {
    Object.assign(this.props, props)
    return this
  }

  getDefaultValue() {
    return 0
  }
}

const hap = {
  Characteristic: FakeCharacteristic,
  Formats: { FLOAT: 'float', UINT16: 'uint16', UINT8: 'uint8', UINT32: 'uint32' },
  Perms: { PAIRED_READ: 'pr', PAIRED_WRITE: 'pw', NOTIFY: 'ev' },
  Units: { SECONDS: 'seconds' },
}

const eveChars = new EveChars({ hap })

describe('the eve current consumption characteristic', () => {
  it('is decimal, so 5.5W is not shown as 6W', () => {
    const characteristic = new eveChars.CurrentConsumption()

    expect(characteristic.props).toMatchObject({ format: 'float', minStep: 0.01, unit: 'W' })
  })

  it('is switched to decimal on an accessory restored from the cache', () => {
    // How an accessory added before this change comes back from Homebridge's
    // cache: with the whole-watt props it was saved with
    const cached = new FakeCharacteristic('Current Consumption', eveChars.uuids.currentConsumption, {
      format: 'uint16',
      unit: 'W',
      minStep: 1,
    })
    const other = new FakeCharacteristic('Total Consumption', eveChars.uuids.totalConsumption, {
      format: 'float',
      minStep: 0.01,
    })
    const accessory = {
      context: {},
      services: [{ characteristics: [cached, other] }],
    }

    // Built with no arguments, the platform skips its set-up, so only the
    // cache restore runs. Homebridge calls this before the plugin launches.
    const platform = new Platform()
    platform.api = { hap }
    platform.configureAccessory(accessory)

    expect(cached.props).toMatchObject({ format: 'float', minStep: 0.01, unit: 'W' })
    expect(other.props).toEqual({ format: 'float', minStep: 0.01 })
  })
})

describe.each([
  ['insight', Insight],
  ['purifier insight', PurifierInsight],
  ['switch insight', SwitchInsight],
])('the %s power reading', (_name, Handler) => {
  it('keeps two decimal places of the milliwatts the device reports', () => {
    const updates = []
    const handler = {
      cachePowerInWatts: 0,
      eveChar: { CurrentConsumption: 'CurrentConsumption' },
      service: { updateCharacteristic: (char, value) => updates.push(value) },
      accessory: { historyService: { addEntry: () => {} }, log: () => {}, logWarn: () => {} },
      wattDiff: 1,
      skipTimeDiff: false,
    }

    Handler.prototype.externalConsumptionUpdate.call(handler, 5494)
    Handler.prototype.externalConsumptionUpdate.call(handler, 5678)

    expect(updates).toEqual([5.49, 5.68])
  })
})
