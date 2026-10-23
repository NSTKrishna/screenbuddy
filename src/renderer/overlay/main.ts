import type { OverlayPayload, OverlayShape } from '@shared/schemas/annotations'

declare global {
  interface Window {
    readonly screenBuddyOverlay: {
      onShow: (cb: (payload: OverlayPayload) => void) => void
      onClear: (cb: () => void) => void
    }
  }
}

const SVG = 'http://www.w3.org/2000/svg'
const layer = document.getElementById('shapes') as unknown as SVGGElement

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

function label(text: string, x: number, y: number): SVGGElement {
  const g = el('g', {})
  const t = el('text', { x: x + 10, y: y + 18, class: 'label' })
  t.textContent = text // textContent, never innerHTML: labels come from the model
  g.append(
    el('rect', { x, y, rx: 6, height: 26, width: 20 + text.length * 7.4, class: 'label-bg' }),
    t,
  )
  return g
}

function draw(s: OverlayShape): SVGGElement {
  const g = el('g', { 'data-type': s.type, 'data-x': s.x, 'data-y': s.y })
  if (s.type === 'arrow') {
    // The arrow points at (x, y) from the upper left, or the upper right near the left edge.
    const fromX = s.x > 140 ? s.x - 110 : s.x + 110
    g.append(
      el('line', {
        x1: fromX,
        y1: s.y - 90,
        x2: s.x,
        y2: s.y,
        class: 'shape pulse',
        'marker-end': 'url(#head)',
      }),
    )
    if (s.label !== '') g.append(label(s.label, fromX - 10, s.y - 126))
  } else if (s.type === 'circle') {
    g.append(el('ellipse', { cx: s.x, cy: s.y, rx: s.w / 2, ry: s.h / 2, class: 'shape pulse' }))
    if (s.label !== '') g.append(label(s.label, s.x - s.w / 2, s.y + s.h / 2 + 8))
  } else {
    g.append(el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 8, class: 'shape pulse' }))
    if (s.label !== '') g.append(label(s.label, s.x, s.y + s.h + 8))
  }
  return g
}

window.screenBuddyOverlay.onShow(({ shapes }) => {
  layer.classList.remove('fading')
  layer.replaceChildren(...shapes.map(draw))
})
window.screenBuddyOverlay.onClear(() => {
  layer.replaceChildren()
})
