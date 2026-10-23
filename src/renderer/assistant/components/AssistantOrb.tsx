import { useRef, type PointerEvent } from 'react'
import { motion } from 'motion/react'
import { bridge } from '../lib/bridge'
import { useAssistantStatus } from '../lib/useAssistantStatus'
import { useUiStore } from '../stores/useUiStore'
import { OrbGlyph } from './OrbGlyph'

/** Pointer travel (px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4

/**
 * The collapsed assistant. Click (or Enter/Space) opens the chat; press and
 * drag moves the window. Main reads the cursor itself, so moves carry no payload.
 */
export function AssistantOrb() {
  const status = useAssistantStatus()
  const expand = useUiStore((s) => s.expand)
  const press = useRef<{ x: number; y: number; dragging: boolean; frame: number } | null>(null)
  const suppressClick = useRef(false)

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.screenX, y: e.screenY, dragging: false, frame: 0 }
  }

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>): void => {
    const p = press.current
    if (p === null) return
    if (!p.dragging) {
      if (Math.hypot(e.screenX - p.x, e.screenY - p.y) < DRAG_THRESHOLD) return
      p.dragging = true
      void bridge().window.dragStart()
    }
    // One move per frame is plenty, and keeps IPC traffic low.
    if (p.frame === 0) {
      p.frame = requestAnimationFrame(() => {
        p.frame = 0
        void bridge().window.dragMove()
      })
    }
  }

  const endPress = (e: PointerEvent<HTMLButtonElement>): void => {
    const p = press.current
    press.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (p?.dragging === true) {
      if (p.frame !== 0) cancelAnimationFrame(p.frame)
      suppressClick.current = true
      void bridge()
        .window.dragMove()
        .then(() => bridge().window.dragEnd())
    }
  }

  return (
    <motion.button
      type="button"
      aria-label="Open ScreenBuddy"
      title="ScreenBuddy: click to chat, drag to move"
      className="absolute right-4 bottom-4 size-14 cursor-pointer touch-none rounded-full outline-offset-4"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.12, ease: 'easeIn' } }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        expand()
      }}
    >
      <OrbGlyph status={status} size={56} glow />
    </motion.button>
  )
}
