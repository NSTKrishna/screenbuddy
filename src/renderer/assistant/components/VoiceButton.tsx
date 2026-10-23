import { Mic, Square } from 'lucide-react'
import { motion } from 'motion/react'
import { VOICE_SHORTCUT_LABEL } from '../lib/voiceShortcut'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useVoiceStore } from '../stores/useVoiceStore'

/** Click to start listening, click again to stop (toggle-to-talk, D-007). */
export function VoiceButton() {
  const phase = useVoiceStore((s) => s.phase)
  const toggle = useVoiceStore((s) => s.toggleListening)
  const shortcut = useSettingsStore((s) => s.settings?.voice.shortcutEnabled === true)
  const listening = phase === 'listening' || phase === 'requesting'
  const busy = phase === 'transcribing'
  const label = listening ? 'Stop listening' : 'Start voice input'

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={listening}
      title={shortcut ? `${label} (${VOICE_SHORTCUT_LABEL})` : label}
      disabled={busy}
      onClick={toggle}
      className={`relative inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
        listening
          ? 'bg-danger/90 text-white'
          : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
      }`}
    >
      {listening && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-xl ring-2 ring-danger/60"
          animate={{ scale: [1, 1.25], opacity: [0.8, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      {listening ? (
        <Square className="size-3" fill="currentColor" strokeWidth={0} />
      ) : (
        <Mic className="size-4" strokeWidth={2} />
      )}
    </button>
  )
}
