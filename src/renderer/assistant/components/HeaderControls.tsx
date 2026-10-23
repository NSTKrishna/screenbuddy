import { Minus, SquarePen, Volume2, VolumeX, X } from 'lucide-react'
import { bridge } from '../lib/bridge'
import { progressLabel } from '../lib/progressLabel'
import { useAssistantStatus, type AssistantStatus } from '../lib/useAssistantStatus'
import { useChatStore } from '../stores/useChatStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useUiStore } from '../stores/useUiStore'
import { useVoiceStore } from '../stores/useVoiceStore'
import { IconButton } from './IconButton'
import { OrbGlyph } from './OrbGlyph'
import { SettingsButton } from './SettingsButton'

const statusLabel: Record<AssistantStatus, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  responding: 'Responding…',
  speaking: 'Speaking…',
  error: 'Something went wrong',
}

/** Panel header. The bare area is a native drag handle; the buttons opt out. */
export function HeaderControls() {
  const status = useAssistantStatus()
  const voice = useSettingsStore((s) => s.settings?.voice)
  const toggleMute = useVoiceStore((s) => s.toggleMute)
  const progress = useChatStore((s) => s.progress)
  const hasMessages = useChatStore((s) => s.messages.length > 0)
  const newChat = useChatStore((s) => s.newChat)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const collapse = useUiStore((s) => s.collapse)
  const requestFocus = useUiStore((s) => s.requestFocus)

  return (
    <header className="app-drag flex h-12 shrink-0 items-center gap-2.5 border-b border-line pr-2 pl-3.5">
      <OrbGlyph status={status} size={20} />
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="text-[13px] font-semibold tracking-[-0.005em] text-ink">ScreenBuddy</h1>
        <p
          className={`truncate text-[11px] ${status === 'error' && view === 'chat' ? 'text-danger' : 'text-ink-faint'}`}
          aria-live="polite"
        >
          {view === 'settings'
            ? 'Settings'
            : status === 'thinking'
              ? `${progressLabel(progress)}…`
              : statusLabel[status]}
        </p>
      </div>
      <div className="flex items-center gap-0.5">
        {voice?.mode === 'voice' && (
          <IconButton
            label={voice.speakResponses ? 'Mute spoken answers' : 'Unmute spoken answers'}
            aria-pressed={!voice.speakResponses}
            onClick={toggleMute}
          >
            {voice.speakResponses ? (
              <Volume2 className="size-[15px]" strokeWidth={2} />
            ) : (
              <VolumeX className="size-[15px]" strokeWidth={2} />
            )}
          </IconButton>
        )}
        <IconButton
          label="New chat"
          disabled={!hasMessages && view === 'chat'}
          onClick={() => {
            newChat()
            setView('chat')
            requestFocus()
          }}
        >
          <SquarePen className="size-[15px]" strokeWidth={2} />
        </IconButton>
        <SettingsButton />
        <IconButton label="Minimize to orb" onClick={collapse}>
          <Minus className="size-4" strokeWidth={2} />
        </IconButton>
        <IconButton
          label="Hide"
          shortcutHint="Esc"
          tone="danger"
          onClick={() => void bridge().window.hide()}
        >
          <X className="size-4" strokeWidth={2} />
        </IconButton>
      </div>
    </header>
  )
}
