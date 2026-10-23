import { describe, expect, it } from 'vitest'
import {
  COLLAPSED_SIZE,
  EDGE_MARGIN,
  EXPANDED_SIZE,
  MIN_EXPANDED_SIZE,
  anchorOf,
  clampRect,
  defaultAnchor,
  displayForAnchor,
  placeWindow,
  rectFromAnchor,
  resolveInitialAnchor,
  sizeForMode,
  type DisplayLike,
} from '../../../src/main/windows/geometry'

const laptop: DisplayLike = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 920 } }
// An external display to the left, with a negative origin.
const external: DisplayLike = { id: 2, workArea: { x: -1920, y: -200, width: 1920, height: 1055 } }
const tiny: DisplayLike = { id: 3, workArea: { x: 0, y: 0, width: 320, height: 300 } }

describe('defaultAnchor', () => {
  it('sits in the bottom-right corner of the work area, inset by the margin', () => {
    expect(defaultAnchor(laptop)).toEqual({ x: 1512 - EDGE_MARGIN, y: 25 + 920 - EDGE_MARGIN })
  })
})

describe('sizeForMode', () => {
  it('uses the fixed orb size when collapsed', () => {
    expect(sizeForMode('collapsed', tiny.workArea)).toEqual(COLLAPSED_SIZE)
  })

  it('uses the preferred panel size when it fits', () => {
    expect(sizeForMode('expanded', laptop.workArea)).toEqual(EXPANDED_SIZE)
  })

  it('shrinks to the display but never below the minimum', () => {
    const size = sizeForMode('expanded', { x: 0, y: 0, width: 360, height: 500 })
    expect(size).toEqual({ width: 360 - 2 * EDGE_MARGIN, height: 500 - 2 * EDGE_MARGIN })
    expect(sizeForMode('expanded', tiny.workArea)).toEqual(MIN_EXPANDED_SIZE)
  })
})

describe('rectFromAnchor / anchorOf', () => {
  it('round-trips', () => {
    const rect = rectFromAnchor({ x: 500, y: 400 }, { width: 88, height: 88 })
    expect(rect).toEqual({ x: 412, y: 312, width: 88, height: 88 })
    expect(anchorOf(rect)).toEqual({ x: 500, y: 400 })
  })
})

describe('clampRect', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 }

  it('leaves a rect that already fits alone', () => {
    const rect = { x: 10, y: 10, width: 100, height: 100 }
    expect(clampRect(rect, area)).toEqual(rect)
  })

  it('pulls a rect back from every edge', () => {
    expect(clampRect({ x: -50, y: -20, width: 100, height: 100 }, area)).toMatchObject({
      x: 0,
      y: 0,
    })
    expect(clampRect({ x: 950, y: 790, width: 100, height: 100 }, area)).toMatchObject({
      x: 900,
      y: 700,
    })
  })

  it('pins an oversized rect to the top-left so its header stays reachable', () => {
    expect(clampRect({ x: 300, y: 300, width: 1200, height: 900 }, area)).toMatchObject({
      x: 0,
      y: 0,
    })
  })

  it('works with negative display origins', () => {
    expect(
      clampRect({ x: -2000, y: -300, width: 100, height: 100 }, external.workArea),
    ).toMatchObject({ x: -1920, y: -200 })
  })
})

describe('displayForAnchor', () => {
  it('picks the display containing the pixel just inside the anchor', () => {
    expect(displayForAnchor({ x: 1512, y: 945 }, [external, laptop])?.id).toBe(1)
    expect(displayForAnchor({ x: -10, y: 300 }, [external, laptop])?.id).toBe(2)
  })

  it('falls back to the nearest display for an off-screen anchor', () => {
    expect(displayForAnchor({ x: 5000, y: 500 }, [external, laptop])?.id).toBe(1)
    expect(displayForAnchor({ x: -5000, y: 0 }, [external, laptop])?.id).toBe(2)
  })

  it('returns undefined with no displays', () => {
    expect(displayForAnchor<DisplayLike>({ x: 0, y: 0 }, [])).toBeUndefined()
  })
})

describe('resolveInitialAnchor', () => {
  it('keeps a saved anchor that is still on a display', () => {
    expect(resolveInitialAnchor({ x: -100, y: 300 }, [laptop, external], laptop)).toEqual({
      x: -100,
      y: 300,
    })
  })

  it('falls back to the primary corner when the saved display is gone', () => {
    expect(resolveInitialAnchor({ x: -100, y: 300 }, [laptop], laptop)).toEqual(
      defaultAnchor(laptop),
    )
  })

  it('uses the primary corner on first launch', () => {
    expect(resolveInitialAnchor(null, [laptop], laptop)).toEqual(defaultAnchor(laptop))
  })
})

describe('placeWindow', () => {
  it('grows the panel up and left from the anchor', () => {
    const anchor = defaultAnchor(laptop)
    const { rect } = placeWindow(anchor, 'expanded', [laptop], laptop)
    expect(anchorOf(rect)).toEqual(anchor)
    expect(rect.width).toBe(EXPANDED_SIZE.width)
  })

  it('keeps the panel on screen when the orb is near the top-left corner', () => {
    const { rect } = placeWindow({ x: 100, y: 125 }, 'expanded', [laptop], laptop)
    expect(rect).toMatchObject({ x: 0, y: 25 })
  })

  it('uses the fallback display when none are connected', () => {
    const { display } = placeWindow({ x: 10, y: 10 }, 'collapsed', [], laptop)
    expect(display.id).toBe(1)
  })
})
