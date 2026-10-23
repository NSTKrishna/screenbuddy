import { ExternalLink, ImagePlus, RotateCcw, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import { motion } from 'motion/react'
import { bridge } from '../lib/bridge'
import { useCaptureStore } from '../stores/useCaptureStore'

const secondary =
  'inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink transition-colors duration-150 hover:bg-surface-hover'

/**
 * Explains a capture that didn't happen. A missing Screen Recording grant gets
 * step-by-step guidance; every case offers uploading an image instead.
 */
export function CaptureNotice({ onPickImage }: { onPickImage: () => void }) {
  const failure = useCaptureStore((s) => s.failure)
  const permission = useCaptureStore((s) => s.permission)
  const dismiss = useCaptureStore((s) => s.dismissFailure)
  const capture = useCaptureStore((s) => s.capture)
  if (failure === null) return null

  const denied = failure.code === 'PERMISSION_DENIED'
  const grantee = permission?.grantee ?? 'ScreenBuddy'
  const canRetry =
    failure.code === 'CAPTURE_FAILED' ||
    failure.code === 'BUSY' ||
    failure.code === 'DISPLAY_NOT_FOUND'

  return (
    <motion.div
      role="alert"
      className={`mb-2 rounded-xl border p-3 ${denied ? 'border-warn/25 bg-warn/[0.06]' : 'border-danger/25 bg-danger/[0.07]'}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
    >
      <div className="flex items-start gap-2.5">
        {denied ? (
          <ShieldAlert className="mt-px size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
        ) : (
          <TriangleAlert
            className="mt-px size-4 shrink-0 text-danger"
            strokeWidth={2}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">
            {denied ? 'Screen Recording is off' : failure.message}
          </p>
          {denied && (
            <>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">
                macOS needs your permission before ScreenBuddy can see the screen.
              </p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[12px] leading-snug text-ink-muted">
                <li>
                  Open System Settings → Privacy &amp; Security → Screen &amp; System Audio
                  Recording.
                </li>
                <li>
                  Turn on <span className="text-ink">{grantee}</span>.
                </li>
                <li>Relaunch ScreenBuddy so macOS applies the change.</li>
              </ol>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-m-1 rounded p-1 text-ink-faint hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6.5">
        {denied && permission?.canOpenSettings !== false && (
          <button
            type="button"
            className={secondary}
            onClick={() => void bridge().permissions.openScreenSettings()}
          >
            <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
            Open System Settings
          </button>
        )}
        {denied && (
          <button type="button" className={secondary} onClick={() => void bridge().app.relaunch()}>
            <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
            Relaunch
          </button>
        )}
        {canRetry && (
          <button type="button" className={secondary} onClick={() => void capture('button')}>
            <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
            Try again
          </button>
        )}
        <button type="button" className={secondary} onClick={onPickImage}>
          <ImagePlus className="size-3.5" strokeWidth={2} aria-hidden />
          {denied ? 'Upload an image instead' : 'Upload an image'}
        </button>
      </div>
    </motion.div>
  )
}
