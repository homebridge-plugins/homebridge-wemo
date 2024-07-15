function hs2rgb(h, s) {
  /*
    Credit:
    https://github.com/WickyNilliams/pure-color
  */
  h = Number.parseInt(h, 10) / 60
  s = Number.parseInt(s, 10) / 100
  const f = h - Math.floor(h)
  const p = 255 * (1 - s)
  const q = 255 * (1 - s * f)
  const t = 255 * (1 - s * (1 - f))
  let rgb
  switch (Math.floor(h) % 6) {
    case 0:
      rgb = [255, t, p]
      break
    case 1:
      rgb = [q, 255, p]
      break
    case 2:
      rgb = [p, 255, t]
      break
    case 3:
      rgb = [p, q, 255]
      break
    case 4:
      rgb = [t, p, 255]
      break
    case 5:
      rgb = [255, p, q]
      break
    default:
      return []
  }
  if (rgb[0] === 255 && rgb[1] <= 25 && rgb[2] <= 25) {
    rgb[1] = 0
    rgb[2] = 0
  }
  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])]
}

function rgb2hs(r, g, b) {
  /*
    Credit:
    https://github.com/WickyNilliams/pure-color
  */
  r = Number.parseInt(r, 10)
  g = Number.parseInt(g, 10)
  b = Number.parseInt(b, 10)
  const min = Math.min(r, g, b)
  const max = Math.max(r, g, b)
  const delta = max - min
  let h
  let s
  if (max === 0) {
    s = 0
  } else {
    s = (delta / max) * 100
  }
  if (max === min) {
    h = 0
  } else if (r === max) {
    h = (g - b) / delta
  } else if (g === max) {
    h = 2 + (b - r) / delta
  } else if (b === max) {
    h = 4 + (r - g) / delta
  }
  h = Math.min(h * 60, 360)

  if (h < 0) {
    h += 360
  }
  return [Math.round(h), Math.round(s)]
}

function rgb2xy(r, g, b) {
  const redC = r / 255
  const greenC = g / 255
  const blueC = b / 255
  const redN = redC > 0.04045 ? ((redC + 0.055) / (1.0 + 0.055)) ** 2.4 : redC / 12.92
  const greenN = greenC > 0.04045 ? ((greenC + 0.055) / (1.0 + 0.055)) ** 2.4 : greenC / 12.92
  const blueN = blueC > 0.04045 ? ((blueC + 0.055) / (1.0 + 0.055)) ** 2.4 : blueC / 12.92
  const X = redN * 0.664511 + greenN * 0.154324 + blueN * 0.162028
  const Y = redN * 0.283881 + greenN * 0.668433 + blueN * 0.047685
  const Z = redN * 0.000088 + greenN * 0.07231 + blueN * 0.986039
  const x = X / (X + Y + Z)
  const y = Y / (X + Y + Z)
  return [x, y]
}

function xy2rgb(x, y) {
  const z = 1 - x - y
  const X = x / y
  const Z = z / y
  let red = X * 1.656492 - 1 * 0.354851 - Z * 0.255038
  let green = -X * 0.707196 + 1 * 1.655397 + Z * 0.036152
  let blue = X * 0.051713 - 1 * 0.121364 + Z * 1.01153
  if (red > blue && red > green && red > 1) {
    green /= red
    blue /= red
    red = 1
  } else if (green > blue && green > red && green > 1) {
    red /= green
    blue /= green
    green = 1
  } else if (blue > red && blue > green && blue > 1.0) {
    red /= blue
    green /= blue
    blue = 1.0
  }
  red = red <= 0.0031308 ? 12.92 * red : (1.0 + 0.055) * red ** (1.0 / 2.4) - 0.055
  green = green <= 0.0031308 ? 12.92 * green : (1.0 + 0.055) * green ** (1.0 / 2.4) - 0.055
  blue = blue <= 0.0031308 ? 12.92 * blue : (1.0 + 0.055) * blue ** (1.0 / 2.4) - 0.055
  red = Math.abs(Math.round(red * 255))
  green = Math.abs(Math.round(green * 255))
  blue = Math.abs(Math.round(blue * 255))
  if (Number.isNaN(red)) {
    red = 0
  }
  if (Number.isNaN(green)) {
    green = 0
  }
  if (Number.isNaN(blue)) {
    blue = 0
  }
  return [red, green, blue]
}

export {
  hs2rgb,
  rgb2hs,
  rgb2xy,
  xy2rgb,
}
