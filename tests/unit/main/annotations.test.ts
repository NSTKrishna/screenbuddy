import { describe, expect, it } from 'vitest'
import {
  DEMO_ANNOTATIONS,
  parseAnnotations,
  toOverlayShapes,
} from '../../../src/main/services/annotations/coordinates'

const retina = { width: 1512, height: 982 } // DIPs of a 3024×1964 @2x display

describe('toOverlayShapes', () => {
  it('maps normalized screenshot coordinates onto the display in DIPs', () => {
    const [arrow, rect] = toOverlayShapes(
      [
        { type: 'arrow', x: 0.5, y: 0.25 },
        { type: 'rect', x: 0.1, y: 0.2, w: 0.5, h: 0.25, label: 'Panel' },
      ],
      retina,
    )
    expect(arrow).toMatchObject({ type: 'arrow', x: 756, y: 246 })
    expect(rect).toEqual({ type: 'rect', x: 151, y: 196, w: 756, h: 246, label: 'Panel' })
  })

  it('is independent of the screenshot’s pixel size (Retina, downscaling)', () => {
    // Same normalized point → same place, whatever resolution the model saw.
    const a = toOverlayShapes([{ type: 'circle', x: 0.75, y: 0.75 }], retina)[0]
    expect(a).toMatchObject({ x: 1134, y: 737, w: 64, h: 64 })
  })

  it('clamps out-of-range values and drops non-finite ones', () => {
    const shapes = toOverlayShapes(
      [
        { type: 'circle', x: 1.4, y: -0.2 },
        { type: 'arrow', x: Number.NaN, y: 0.5 },
        { type: 'rect', x: 0.5, y: 0.5, w: Number.POSITIVE_INFINITY },
      ],
      retina,
    )
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ x: 1512, y: 0 })
  })

  it('draws at most 8 shapes', () => {
    const many = Array.from({ length: 20 }, () => ({ type: 'arrow' as const, x: 0.5, y: 0.5 }))
    expect(toOverlayShapes(many, retina)).toHaveLength(8)
  })

  it('the demo set fits on screen', () => {
    for (const s of toOverlayShapes(DEMO_ANNOTATIONS, retina)) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x + (s.type === 'rect' ? s.w : 0)).toBeLessThanOrEqual(retina.width)
    }
  })
})

describe('parseAnnotations', () => {
  it('reads the fenced block at the end of an answer', () => {
    const text =
      'Click **Save**.\n\n```annotations\n[{"type":"circle","x":0.42,"y":0.18,"label":"Save"}]\n```'
    expect(parseAnnotations(text)).toEqual([{ type: 'circle', x: 0.42, y: 0.18, label: 'Save' }])
  })

  it('ignores answers without a block, malformed JSON, and invalid items', () => {
    expect(parseAnnotations('Just text.')).toEqual([])
    expect(parseAnnotations('```annotations\n[{"type":"circle",\n```')).toEqual([])
    expect(parseAnnotations('```annotations\n{"type":"circle"}\n```')).toEqual([])
    expect(
      parseAnnotations(
        '```annotations\n[{"type":"laser","x":1,"y":1},{"type":"rect","x":"a"},{"type":"arrow","x":0.1,"y":0.2}]\n```',
      ),
    ).toEqual([{ type: 'arrow', x: 0.1, y: 0.2 }])
  })
})
