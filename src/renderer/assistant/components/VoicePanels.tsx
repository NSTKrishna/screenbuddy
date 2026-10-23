import { useEffect } from 'react'
import {
  ExternalLink,
  LoaderCircle,
  MicOff,
  RotateCw,
  Settings,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { bridge } from '../lib/bridge'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useUiStore } from '../stores/useUiStore'
import { useVoiceStore } from '../stores/useVoiceStore'
import { Waveform } from './Indicators'

function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const chip =
  'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink'

/** Replaces the text box while the microphone is open. Impossible to miss. */
export function ListeningRow() {
  const phase = useVoiceStore((s) => s.phase)
  const levels = useVoiceStore((s) => s.levels)
  const elapsed = useVoiceStore((s) => s.elapsedMs)
  const stop = useVoiceStore((s) => s.stopListening)
  const cancel = useVoiceStore((s) => s.cancel)
  return (
    <div className="flex min-h-8 items-center gap-2 pl-2" role="status" aria-label="Listening">
      <motion.span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-danger"
        animate={{ opacity: [1, 0.35, 1] }}
        transition={{ duration: 1.2, repeat: Infinity }}
      />
      <span className="shrink-0 text-[12px] whitespace-nowrap text-ink tabular-nums">
        {phase === 'requesting' ? 'Starting…' : `Listening ${clock(elapsed)}`}
      </span>
      <Waveform levels={levels} />
      <button
        type="button"
        className={chip}
        onClick={() => void stop()}
        aria-label="Stop and transcribe"
      >
        <Square className="size-3" fill="currentColor" strokeWidth={0} aria-hidden />
        Done
      </button>
      <button type="button" className={chip} onClick={cancel} aria-label="Cancel recording">
        <X className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}

/** Shows live partial text when the provider streams it. */
export function TranscribingRow() {
  const partial = useVoiceStore((s) => s.partial)
  const cancel = useVoiceStore((s) => s.cancel)
  return (
    <div
      className="flex min-h-8 items-start gap-2 px-2 py-[7px]"
      role="status"
      aria-label="Transcribing"
    >
      <LoaderCircle
        className="mt-0.5 size-3.5 shrink-0 animate-spin text-aurora-1"
        strokeWidth={2.2}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-[13.5px] leading-[18px]" data-testid="partial-transcript">
        {partial === '' ? (
          <span className="text-ink-faint">Transcribing…</span>
        ) : (
          <span className="text-ink/80">{partial}</span>
        )}
      </p>
      <button type="button" className={chip} onClick={cancel} aria-label="Cancel transcription">
        <X className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}

/** Controls for a spoken answer: stop, mute, volume. Replay is on each message. */
export function SpeechBar() {
  const phase = useVoiceStore((s) => s.phase)
  const stop = useVoiceStore((s) => s.stopSpeaking)
  const toggleMute = useVoiceStore((s) => s.toggleMute)
  const setVolume = useVoiceStore((s) => s.setVolume)
  const notice = useVoiceStore((s) => s.notice)
  const volume = useSettingsStore((s) => s.settings?.voice.volume ?? 0.9)
  if (phase !== 'speaking') return null
  return (
    <motion.div
      role="status"
      aria-label="Speaking"
      className="mb-2 rounded-xl border border-aurora-2/25 bg-aurora-2/[0.07] px-2.5 py-1.5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2">
        <Waveform compact />
        <span className="text-[12px] text-ink">Speaking</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-ink-faint" title="Volume">
          <Volume2 className="size-3.5" strokeWidth={2} aria-hidden />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label="Volume"
            onChange={(e) => setVolume(Number(e.target.value))}
            className="h-1 w-16 accent-[var(--color-aurora-2)]"
          />
        </label>
        <button
          type="button"
          className={chip}
          onClick={toggleMute}
          aria-label="Mute spoken answers"
        >
          <VolumeX className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
        <button type="button" className={chip} onClick={stop} aria-label="Stop speaking">
          <Square className="size-3" fill="currentColor" strokeWidth={0} aria-hidden />
          Stop
        </button>
      </div>
      {notice !== null && <p className="mt-1 text-[11px] text-ink-faint">{notice}</p>}
    </motion.div>
  )
}

/** Microphone and transcription problems, each with the action that fixes it. */
export function VoiceNotice() {
  const error = useVoiceStore((s) => s.error)
  const permission = useVoiceStore((s) => s.permission)
  const canRetry = useVoiceStore((s) => s.canRetry)
  const retry = useVoiceStore((s) => s.retryTranscription)
  const dismiss = useVoiceStore((s) => s.dismissError)
  const setView = useUiStore((s) => s.setView)

  // "Didn't hear anything" is a gentle note; it clears itself.
  useEffect(() => {
    if (error?.code !== 'NO_SPEECH') return
    const timer = setTimeout(dismiss, 5000)
    return () => clearTimeout(timer)
  }, [error, dismiss])

  if (error === null) return null
  const denied = error.code === 'MIC_DENIED'
  const gentle = error.code === 'NO_SPEECH'
  const settingsFix =
    error.code === 'NOT_CONFIGURED' ||
    error.code === 'INVALID_API_KEY' ||
    error.code === 'UNSUPPORTED'
  const button =
    'inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-surface-hover'

  return (
    <motion.div
      role={gentle ? 'status' : 'alert'}
      className={`mb-2 rounded-xl border p-3 ${
        gentle
          ? 'border-line bg-surface-raised'
          : denied
            ? 'border-warn/25 bg-warn/[0.06]'
            : 'border-danger/25 bg-danger/[0.07]'
      }`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-start gap-2.5">
        <MicOff
          className={`mt-px size-4 shrink-0 ${gentle ? 'text-ink-muted' : denied ? 'text-warn' : 'text-danger'}`}
          strokeWidth={2}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">
            {denied ? 'Microphone access is off' : error.message}
          </p>
          {denied && (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[12px] leading-snug text-ink-muted">
              <li>Open System Settings → Privacy &amp; Security → Microphone.</li>
              <li>
                Turn on <span className="text-ink">{permission?.grantee ?? 'ScreenBuddy'}</span>,
                then try again.
              </li>
            </ol>
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
      {(denied || canRetry || settingsFix) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6.5">
          {denied && permission?.canOpenSettings !== false && (
            <button
              type="button"
              className={button}
              onClick={() => void bridge().permissions.openMicrophoneSettings()}
            >
              <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
              Open System Settings
            </button>
          )}
          {canRetry && (
            <button type="button" className={button} onClick={retry}>
              <RotateCw className="size-3.5" strokeWidth={2} aria-hidden />
              Retry transcription
            </button>
          )}
          {settingsFix && (
            <button type="button" className={button} onClick={() => setView('settings')}>
              <Settings className="size-3.5" strokeWidth={2} aria-hidden />
              Open Settings
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}
