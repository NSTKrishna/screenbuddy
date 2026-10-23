import { useEffect, useRef } from 'react'
import { Lock, Maximize2, RefreshCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { CaptureResult } from '@shared/schemas/capture'
import { destinationOf, imagePrivacyNote } from '../lib/destination'
import { useCaptureStore } from '../stores/useCaptureStore'
import { useSettingsStore } from '../stores/useSettingsStore'

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function title(a: CaptureResult): string {
  return a.source === 'screen' ? `Screenshot of ${a.label}` : a.label
}

/** The pending attachment in the composer: thumbnail, what it is, and how to undo it. */
export function AttachmentPreview() {
  const attachment = useCaptureStore((s) => s.attachment)
  const remove = useCaptureStore((s) => s.remove)
  const capture = useCaptureStore((s) => s.capture)
  const setPreviewOpen = useCaptureStore((s) => s.setPreviewOpen)
  const note = imagePrivacyNote(destinationOf(useSettingsStore((s) => s.settings)))

  return (
    <AnimatePresence initial={false}>
      {attachment !== null && (
        <motion.div
          // One card that updates in place on retake (the capture flash marks the change),
          // rather than two overlapping while one animates out.
          key="attachment"
          role="group"
          aria-label="Attached image"
          className="flex gap-2.5 rounded-xl border border-line bg-black/20 p-1.5"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label="Enlarge preview"
            className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-black"
          >
            <img
              src={attachment.preview.dataUrl}
              alt={`Preview: ${title(attachment)}`}
              className="size-full object-cover"
              draggable={false}
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Maximize2 className="size-4 text-white" strokeWidth={2} aria-hidden />
            </span>
          </button>
          <div className="min-w-0 flex-1 py-0.5">
            <p className="truncate text-[12.5px] font-medium text-ink">{title(attachment)}</p>
            <p className="text-[11px] text-ink-faint">
              {attachment.width}×{attachment.height} · {formatBytes(attachment.byteSize)}
            </p>
            <p className="mt-1 flex items-start gap-1 text-[10.5px] leading-snug text-ink-faint">
              <Lock className="mt-px size-2.5 shrink-0" strokeWidth={2.4} aria-hidden />
              <span>{note}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-0.5">
            {attachment.source === 'screen' && (
              <button
                type="button"
                onClick={() => void capture('retake')}
                aria-label="Retake screenshot"
                title="Retake"
                className="inline-flex size-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-hover hover:text-ink"
              >
                <RefreshCw className="size-3.5" strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={remove}
              aria-label="Remove attachment"
              title="Remove"
              className="inline-flex size-7 items-center justify-center rounded-lg text-ink-muted hover:bg-danger/10 hover:text-danger"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Full-panel view of the pending attachment, for checking what would be shared. */
export function AttachmentLightbox() {
  const attachment = useCaptureStore((s) => s.attachment)
  const open = useCaptureStore((s) => s.previewOpen)
  const setPreviewOpen = useCaptureStore((s) => s.setPreviewOpen)
  const remove = useCaptureStore((s) => s.remove)
  const capture = useCaptureStore((s) => s.capture)
  const note = imagePrivacyNote(destinationOf(useSettingsStore((s) => s.settings)))
  const done = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) done.current?.focus()
  }, [open])

  return (
    <AnimatePresence>
      {open && attachment !== null && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot preview"
          className="absolute inset-0 z-30 flex flex-col rounded-[20px] bg-[#0d0e12]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
            <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
              {title(attachment)}
            </p>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              aria-label="Close preview"
              className="inline-flex size-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-3.5">
            <img
              src={attachment.preview.dataUrl}
              alt={`Preview: ${title(attachment)}`}
              className="max-h-full max-w-full rounded-lg border border-line object-contain"
              draggable={false}
            />
          </div>
          <p className="flex items-start gap-1.5 px-3.5 pt-3 text-[11px] leading-snug text-ink-muted">
            <Lock className="mt-0.5 size-3 shrink-0" strokeWidth={2.2} aria-hidden />
            {note}
          </p>
          <div className="flex items-center gap-2 p-3.5">
            <button
              type="button"
              onClick={remove}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-surface-hover"
            >
              Remove
            </button>
            {attachment.source === 'screen' && (
              <button
                type="button"
                onClick={() => void capture('retake')}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-surface-hover"
              >
                Retake
              </button>
            )}
            <button
              ref={done}
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="ml-auto rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-[#111218]"
            >
              Keep
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
