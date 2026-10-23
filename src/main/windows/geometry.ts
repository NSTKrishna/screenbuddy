import type { AssistantMode } from '@shared/ipc/contract'

/** Pure placement math for the assistant window. All values are screen DIPs. */

export interface Point {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
export interface Rect extends Point, Size {}
export interface DisplayLike {
  id: number
  workArea: Rect
}

/** The orb plus room for its glow and shadow. */
export const COLLAPSED_SIZE: Size = { width: 88, height: 88 }
/** The preferred chat panel size; shrinks on small displays. */
export const EXPANDED_SIZE: Size = { width: 400, height: 620 }
export const MIN_EXPANDED_SIZE: Size = { width: 300, height: 360 }
/** Gap between the window and the work-area edge for the default placement. */
export const EDGE_MARGIN = 12

export function defaultAnchor(display: DisplayLike): Point {
  const { workArea: wa } = display
  return { x: wa.x + wa.width - EDGE_MARGIN, y: wa.y + wa.height - EDGE_MARGIN }
}

export function sizeForMode(mode: AssistantMode, workArea: Rect): Size {
  if (mode === 'collapsed') return COLLAPSED_SIZE
  const maxWidth = workArea.width - EDGE_MARGIN * 2
  const maxHeight = workArea.height - EDGE_MARGIN * 2
  return {
    width: Math.round(Math.max(MIN_EXPANDED_SIZE.width, Math.min(EXPANDED_SIZE.width, maxWidth))),
    height: Math.round(
      Math.max(MIN_EXPANDED_SIZE.height, Math.min(EXPANDED_SIZE.height, maxHeight)),
    ),
  }
}

/** The rect whose bottom-right corner sits at `anchor`. */
export function rectFromAnchor(anchor: Point, size: Size): Rect {
  return {
    x: Math.round(anchor.x - size.width),
    y: Math.round(anchor.y - size.height),
    width: size.width,
    height: size.height,
  }
}

export function anchorOf(rect: Rect): Point {
  return { x: rect.x + rect.width, y: rect.y + rect.height }
}

/**
 * Shifts `rect` so it lies inside `area`. A rect larger than the area is
 * pinned to the area's top-left so the header (and its controls) stay reachable.
 */
export function clampRect(rect: Rect, area: Rect): Rect {
  const maxX = area.x + area.width - rect.width
  const maxY = area.y + area.height - rect.height
  return {
    x: Math.round(Math.max(area.x, Math.min(rect.x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(rect.y, maxY))),
    width: rect.width,
    height: rect.height,
  }
}

export function containsPoint(area: Rect, p: Point): boolean {
  return p.x >= area.x && p.x < area.x + area.width && p.y >= area.y && p.y < area.y + area.height
}

function distanceToRect(area: Rect, p: Point): number {
  const dx = Math.max(area.x - p.x, 0, p.x - (area.x + area.width))
  const dy = Math.max(area.y - p.y, 0, p.y - (area.y + area.height))
  return Math.hypot(dx, dy)
}

/**
 * The display an anchor belongs to. The anchor is an exclusive bottom-right
 * corner, so the pixel just inside it is what decides.
 */
export function displayForAnchor<D extends DisplayLike>(
  anchor: Point,
  displays: readonly D[],
): D | undefined {
  const inside = { x: anchor.x - 1, y: anchor.y - 1 }
  const containing = displays.find((d) => containsPoint(d.workArea, inside))
  if (containing !== undefined) return containing
  let best: D | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const d of displays) {
    const distance = distanceToRect(d.workArea, inside)
    if (distance < bestDistance) {
      best = d
      bestDistance = distance
    }
  }
  return best
}

/**
 * Picks the starting anchor: the saved one if it is still on a connected
 * display, otherwise the bottom-right corner of the primary display.
 */
export function resolveInitialAnchor(
  saved: Point | null,
  displays: readonly DisplayLike[],
  primary: DisplayLike,
): Point {
  if (saved !== null) {
    const inside = { x: saved.x - 1, y: saved.y - 1 }
    if (displays.some((d) => containsPoint(d.workArea, inside))) return saved
  }
  return defaultAnchor(primary)
}

/** Where the window goes for `mode`, given its anchor and the connected displays. */
export function placeWindow(
  anchor: Point,
  mode: AssistantMode,
  displays: readonly DisplayLike[],
  fallback: DisplayLike,
): { rect: Rect; display: DisplayLike } {
  const display = displayForAnchor(anchor, displays) ?? fallback
  const size = sizeForMode(mode, display.workArea)
  const rect = clampRect(rectFromAnchor(anchor, size), display.workArea)
  return { rect, display }
}
