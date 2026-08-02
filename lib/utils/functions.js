function decodeXML(input) {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, '\'')
}

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  while (nonce.length < length) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

const hasProperty = (obj, prop) => Object.hasOwn(obj, prop)

function parseError(err, hideStack = []) {
  let toReturn = err.message
  if (err?.stack?.length > 0 && !hideStack.includes(err.message)) {
    const stack = err.stack.split('\n')
    if (stack[1]) {
      toReturn += stack[1].replace('   ', '')
    }
  }
  return toReturn
}

// Whether two IPv4 addresses sit in the same subnet for the given netmask.
// Replaces the single ip.subnet().contains() call this plugin used from the
// `ip` package, which carries an unfixed npm advisory (GHSA in its isPublic).
function sameIpv4Subnet(addressA, addressB, netmask) {
  const toInt = addr => addr.split('.').reduce((acc, octet) => (acc * 256) + Number.parseInt(octet, 10), 0)
  const mask = toInt(netmask)
  return ((toInt(addressA) & mask) >>> 0) === ((toInt(addressB) & mask) >>> 0)
}

function parseSerialNumber(input) {
  return input
    .toString()
    .replace(/[\s'"]+/g, '')
    .toUpperCase()
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export {
  decodeXML,
  generateRandomString,
  hasProperty,
  parseError,
  parseSerialNumber,
  sameIpv4Subnet,
  sleep,
}
