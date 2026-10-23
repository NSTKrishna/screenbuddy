// Renders the menu-bar template icon (black + alpha, as macOS expects) at
// 1x and 2x, with no image dependencies. Run with `npm run icons`.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const POINTS = 18
const SUPERSAMPLE = 6

/** Coverage (0..1) of the glyph at a point in 18-point space. */
function glyph(x, y) {
  const cx = 8.5
  const cy = 9.5
  const d = Math.hypot(x - cx, y - cy)
  // Outer ring.
  if (d >= 5.1 && d <= 6.7) return 1
  // Core.
  if (d <= 2.4) return 1
  // Small orbiting spark at the upper right.
  if (Math.hypot(x - 15, y - 3) <= 1.7) return 1
  return 0
}

function render(scale) {
  const size = POINTS * scale
  const rows = []
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0 // filter: none
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / scale
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / scale
          hits += glyph(x, y)
        }
      }
      const alpha = Math.round((hits / SUPERSAMPLE ** 2) * 255)
      row.writeUInt32BE(alpha, 1 + px * 4) // r=g=b=0, a=alpha
    }
    rows.push(row)
  }
  return png(size, size, Buffer.concat(rows))
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'trayTemplate.png'), render(1))
writeFileSync(join(outDir, 'trayTemplate@2x.png'), render(2))
console.log(`wrote tray icons to ${outDir}`)
