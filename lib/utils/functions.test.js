import { describe, expect, it } from 'vitest'

import { decodeXML, generateRandomString, hasProperty, parseError, parseSerialNumber } from './functions.js'

describe('decodeXML', () => {
  it('decodes the entities wemo devices put in their soap responses', () => {
    expect(decodeXML('&lt;tag&gt;')).toBe('<tag>')
    expect(decodeXML('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeXML('&quot;quoted&quot;')).toBe('"quoted"')
    expect(decodeXML('it&#039;s')).toBe('it\'s')
  })

  it('decodes a realistic nested payload', () => {
    // Wemo wraps its state XML inside another XML document, so the inner
    // document arrives entity-encoded and has to be decoded before parsing.
    expect(decodeXML('&lt;BinaryState&gt;1&lt;/BinaryState&gt;'))
      .toBe('<BinaryState>1</BinaryState>')
  })

  it('leaves text with no entities untouched', () => {
    expect(decodeXML('plain text')).toBe('plain text')
    expect(decodeXML('')).toBe('')
  })

  it('decodes an escaped ampersand entity twice, because &amp; is replaced first', () => {
    // ⚠️ Documenting real behaviour, not endorsing it. The replacements run in
    // order with &amp; first, so "&amp;lt;" becomes "&lt;" and is then decoded
    // again to "<". Anything relying on a literal "&lt;" surviving would be
    // disappointed - worth knowing if this is ever reused elsewhere.
    expect(decodeXML('&amp;lt;')).toBe('<')
  })
})

describe('parseSerialNumber', () => {
  it('uppercases and strips the spacing users paste in', () => {
    expect(parseSerialNumber('abc 123')).toBe('ABC123')
    expect(parseSerialNumber('  abc123  ')).toBe('ABC123')
  })

  it('strips quotes, which get added when copying from a log', () => {
    expect(parseSerialNumber('"ABC123"')).toBe('ABC123')
    expect(parseSerialNumber('\'ABC123\'')).toBe('ABC123')
  })

  it('accepts a non-string value without throwing', () => {
    expect(parseSerialNumber(123456)).toBe('123456')
  })

  it('leaves an already-clean serial alone', () => {
    expect(parseSerialNumber('ABC123')).toBe('ABC123')
  })
})

describe('generateRandomString', () => {
  it('returns the requested length', () => {
    expect(generateRandomString(16)).toHaveLength(16)
  })

  it('uses only lowercase letters and digits', () => {
    expect(generateRandomString(200)).toMatch(/^[a-z0-9]+$/)
  })

  it('does not return the same value twice in a row', () => {
    expect(generateRandomString(32)).not.toBe(generateRandomString(32))
  })
})

describe('hasProperty', () => {
  it('detects own properties only', () => {
    expect(hasProperty({ a: 1 }, 'a')).toBe(true)
    expect(hasProperty({ a: undefined }, 'a')).toBe(true)
    expect(hasProperty({}, 'a')).toBe(false)
  })

  it('ignores inherited properties', () => {
    expect(hasProperty({}, 'toString')).toBe(false)
  })
})

describe('parseError', () => {
  it('appends the first stack frame to the message', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at thing (/a.js:1:1)'
    expect(parseError(err)).toBe('boom at thing (/a.js:1:1)')
  })

  it('hides the stack for errors the caller expects', () => {
    const err = new Error('EHOSTUNREACH')
    err.stack = 'Error: EHOSTUNREACH\n    at thing (/a.js:1:1)'
    expect(parseError(err, ['EHOSTUNREACH'])).toBe('EHOSTUNREACH')
  })

  it('returns the message when there is no stack', () => {
    const err = new Error('nostack')
    err.stack = ''
    expect(parseError(err)).toBe('nostack')
  })
})
