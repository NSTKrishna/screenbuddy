import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, ImagePlus, Monitor } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { CaptureTarget, DisplayInfo } from '@shared/schemas/capture'
import { useCaptureStore } from '../stores/useCaptureStore'

function sameTarget(a: CaptureTarget, b: CaptureTarget): boolean {
  if (a.kind === 'active') return b.kind === 'active'
  return b.kind === 'display' && a.displayId === b.displayId
}

function targetName(target: CaptureTarget, displays: DisplayInfo[]): string {
  if (target.kind === 'active') return 'the display ScreenBuddy is on'
  return displays.find((d) => d.id === target.displayId)?.label ?? 'the selected display'
}

/** Picks which display to capture. Choosing one captures it straight away. */
function DisplayMenu({ onClose }: { onClose: () => void }) {
  const displays = useCaptureStore((s) => s.displays)
  const target = useCaptureStore((s) => s.target)
  const capture = useCaptureStore((s) => s.capture)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [])

  const choose = (next: CaptureTarget): void => {
    onClose()
    void capture('button', next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
    ]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    } else if (e.key === 'Escape') {
      // Close only the menu, not the whole window.
      e.stopPropagation()
      onClose()
    }
  }

  const options: { target: CaptureTarget; title: string; detail: string }[] = [
    { target: { kind: 'active' }, title: 'This display', detail: 'Wherever ScreenBuddy is' },
    ...displays.map((d) => ({
      target: { kind: 'display', displayId: d.id } as const,
      title: d.label,
      detail: `${d.pixelWidth}×${d.pixelHeight}${d.scaleFactor > 1 ? ` · ${d.scaleFactor}x` : ''}${d.isPrimary ? ' · Main' : ''}`,
    })),
  ]

  return (
    <motion.div
      ref={list}
      role="menu"
      aria-label="Choose a display to capture"
      onKeyDown={onKeyDown}
      className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-line-strong bg-[#1c1d25] p-1 shadow-xl"
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ duration: 0.14 }}
    >
      <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-ink-faint">Capture</p>
      {options.map((o) => {
        const checked = sameTarget(o.target, target)
        return (
          <button
            key={o.target.kind === 'active' ? 'active' : o.target.displayId}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            onClick={() => choose(o.target)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Monitor className="size-4 shrink-0 text-ink-muted" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">{o.title}</span>
              <span className="block truncate text-[11px] text-ink-faint">{o.detail}</span>
            </span>
            {checked && <Check className="size-3.5 text-aurora-1" strokeWidth={2.4} aria-hidden />}
          </button>
        )
      })}
    </motion.div>
  )
}

interface CaptureControlsProps {
  onPickImage: () => void
  disabled: boolean
}

export function CaptureControls({ onPickImage, disabled }: CaptureControlsProps) {
  const status = useCaptureStore((s) => s.status)
  const attachment = useCaptureStore((s) => s.attachment)
  const displays = useCaptureStore((s) => s.displays)
  const target = useCaptureStore((s) => s.target)
  const capture = useCaptureStore((s) => s.capture)
  const loadDisplays = useCaptureStore((s) => s.loadDisplays)
  const [menuOpen, setMenuOpen] = useState(false)
  const busy = disabled || status === 'capturing'

  useEffect(() => {
    void loadDisplays()
  }, [loadDisplays])

  return (
    <div className="relative flex items-center gap-0.5">
      <div className="flex items-center rounded-lg border border-line bg-white/[0.03]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void capture(attachment === null ? 'button' : 'retake')}
          title={`Capture ${targetName(target, displays)}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-l-lg pr-2 pl-2 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <Monitor className="size-3.5" strokeWidth={2} aria-hidden />
          Capture screen
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label="Choose display"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            if (!menuOpen) void loadDisplays()
            setMenuOpen(!menuOpen)
          }}
          className="inline-flex h-7 w-6 items-center justify-center rounded-r-lg border-l border-line text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronDown className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onPickImage}
        aria-label="Attach an image"
        title="Attach an image (PNG or JPEG)"
        className="inline-flex size-7 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <ImagePlus className="size-4" strokeWidth={1.9} />
      </button>
      <AnimatePresence>
        {menuOpen && <DisplayMenu onClose={() => setMenuOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}
