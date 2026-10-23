import { Annotation, MAX_ANNOTATIONS, type OverlayShape } from '@shared/schemas/annotations'

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Normalized screenshot coordinates → overlay pixels on the captured display
 * (ARCHITECTURE.md §6.3). The screenshot is the whole display, so 0..1 maps
 * straight onto the display's DIP size; Retina scale doesn't matter.
 * Values are clamped; anything non-finite is dropped.
 */
export function toOverlayShapes(
  items: readonly Annotation[],
  display: { width: number; height: number },
): OverlayShape[] {
  const shapes: OverlayShape[] = []
  for (const a of items) {
    if (shapes.length >= MAX_ANNOTATIONS) break
    const values = [a.x, a.y, a.w ?? 0, a.h ?? 0]
    if (!values.every(Number.isFinite)) continue
    const x = Math.round(clamp01(a.x) * display.width)
    const y = Math.round(clamp01(a.y) * display.height)
    // Defaults: a 64 px circle, a 10% × 6% box; arrows have no size.
    const w =
      a.w === undefined
        ? a.type === 'rect'
          ? display.width * 0.1
          : 64
        : clamp01(a.w) * display.width
    const h =
      a.h === undefined
        ? a.type === 'rect'
          ? display.height * 0.06
          : w
        : clamp01(a.h) * display.height
    shapes.push({ type: a.type, x, y, w: Math.round(w), h: Math.round(h), label: a.label ?? '' })
  }
  return shapes
}

/**
 * Pulls annotations out of an answer: the model is asked to end with a
 * ```annotations fenced block holding a JSON array. Anything malformed is
 * ignored, so a bad answer never draws anything (SECURITY.md §6).
 */
export function parseAnnotations(text: string): Annotation[] {
  const block = /```annotations\s*([\s\S]*?)```/i.exec(text)
  if (block?.[1] === undefined) return []
  let raw: unknown
  try {
    raw = JSON.parse(block[1])
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const parsed = Annotation.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

/** A fixed set for the manual demo, independent of any model. */
export const DEMO_ANNOTATIONS: Annotation[] = [
  { type: 'arrow', x: 0.5, y: 0.5, label: 'Centre of the screen' },
  { type: 'circle', x: 0.2, y: 0.25, w: 0.06, label: 'Circle' },
  { type: 'rect', x: 0.65, y: 0.65, w: 0.25, h: 0.2, label: 'Box' },
]
