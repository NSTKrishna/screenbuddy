// Renders the 1024×1024 app icon (build/icon.png) with no image dependencies:
// the ScreenBuddy orb on a dark rounded square. Run with `npm run icons`.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
const S = 1024
const SS = 2 // supersampling per axis

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const CYAN = [125, 211, 252]
const VIOLET = [167, 139, 250]
const PINK = [240, 171, 252]

function aurora(angle) {
  const t = (((angle / (2 * Math.PI)) % 1) + 1) % 1
  return t < 1 / 3
    ? mix(CYAN, VIOLET, t * 3)
    : t < 2 / 3
      ? mix(VIOLET, PINK, (t - 1 / 3) * 3)
      : mix(PINK, CYAN, (t - 2 / 3) * 3)
}

/** Colour and coverage at a point, in icon space (0..1024). */
function sample(x, y) {
  // macOS-style rounded square with an inset, as Big Sur icons use.
  const m = 100,
    r = 185
  const qx = Math.max(m + r - x, 0, x - (S - m - r)),
    qy = Math.max(m + r - y, 0, y - (S - m - r))
  if (Math.hypot(qx, qy) > r) return null
  const bg = mix([36, 37, 48], [14, 15, 20], (y - m) / (S - 2 * m))
  const cx = 512,
    cy = 512,
    d = Math.hypot(x - cx, y - cy),
    a = Math.atan2(y - cy, x - cx)
  if (d <= 92) return mix(CYAN, VIOLET, (x - cx + 92) / 184) // core
  if (d <= 250) {
    const shade = 1 - (d / 250) * 0.6
    const hi = Math.max(0, 1 - Math.hypot(x - 430, y - 420) / 170) * 50
    return [18 * shade + hi, 19 * shade + hi, 26 * shade + hi] // dark glass sphere
  }
  if (d <= 290) return aurora(a) // rim
  const glow = Math.max(0, 1 - (d - 290) / 90)
  return mix(bg, aurora(a), glow * 0.45)
}

const rows = []
for (let py = 0; py < S; py++) {
  const row = Buffer.alloc(1 + S * 4)
  for (let px = 0; px < S; px++) {
    let r = 0,
      g = 0,
      b = 0,
      n = 0
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
        if (c) {
          r += c[0]
          g += c[1]
          b += c[2]
          n++
        }
      }
    const o = 1 + px * 4
    if (n > 0) {
      row[o] = r / n
      row[o + 1] = g / n
      row[o + 2] = b / n
      row[o + 3] = (255 * n) / (SS * SS)
    }
  }
  rows.push(row)
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6
mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]),
)
console.log(`wrote ${out}`)
