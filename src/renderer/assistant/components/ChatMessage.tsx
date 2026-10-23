import { Image, Monitor, Square, Volume2 } from 'lucide-react'
import { motion } from 'motion/react'
import type { AttachmentMeta, ChatMessage as Message } from '../stores/useChatStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useVoiceStore } from '../stores/useVoiceStore'
import { Markdown } from './Markdown'

/** Notes that an image went with a message. The image itself is not kept. */
function AttachmentChip({ attachment }: { attachment: AttachmentMeta }) {
  const Icon = attachment.source === 'upload' ? Image : Monitor
  const label =
    attachment.source === 'screen' ? `Screenshot · ${attachment.label}` : attachment.label
  return (
    <p className="flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-white/[0.04] px-2 py-1 text-[11.5px] text-ink-muted">
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="truncate">{label}</span>
      {attachment.width !== undefined && attachment.height !== undefined && (
        <span className="shrink-0 text-ink-faint">
          {attachment.width}×{attachment.height}
        </span>
      )}
    </p>
  )
}

/**
 * The ```annotations block is for the overlay, not for reading; it's hidden
 * here (even while half-streamed).
 */
export function withoutAnnotations(text: string): string {
  return text.replace(/```annotations[\s\S]*?(```|$)/gi, '').trimEnd()
}

/** Replay: reads any finished answer aloud, or stops it if it's the one speaking. */
function ReadAloud({ message }: { message: Message }) {
  const voiceMode = useSettingsStore((s) => s.settings?.voice.mode === 'voice')
  const speaking = useVoiceStore((s) => s.speakingId === message.id)
  const speak = useVoiceStore((s) => s.speak)
  const stop = useVoiceStore((s) => s.stopSpeaking)
  if (!voiceMode || message.state !== 'done' || message.text === '') return null
  return (
    <button
      type="button"
      onClick={() => (speaking ? stop() : void speak(message.id, message.text))}
      aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
      title={speaking ? 'Stop' : 'Read aloud'}
      className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-opacity duration-150 hover:bg-surface-hover hover:text-ink focus-visible:opacity-100 ${
        speaking
          ? 'text-aurora-1 opacity-100'
          : 'text-ink-faint opacity-0 group-hover/msg:opacity-100'
      }`}
    >
      {speaking ? (
        <Square className="size-2.5" fill="currentColor" strokeWidth={0} aria-hidden />
      ) : (
        <Volume2 className="size-3" strokeWidth={2} aria-hidden />
      )}
      {speaking ? 'Stop' : 'Read aloud'}
    </button>
  )
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const streaming = message.state === 'streaming'

  return (
    <motion.li
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {isUser ? (
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          {message.attachment !== undefined && <AttachmentChip attachment={message.attachment} />}
          {message.text !== '' && (
            <p className="rounded-2xl rounded-br-md border border-white/[0.07] bg-[linear-gradient(135deg,rgb(125_211_252/0.16),rgb(167_139_250/0.16))] px-3 py-2 text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-ink select-text">
              <span className="sr-only">You: </span>
              {message.text}
            </p>
          )}
        </div>
      ) : (
        <div className="group/msg max-w-[94%] min-w-0 text-[13.5px] leading-[1.55] text-ink/90">
          <span className="sr-only">ScreenBuddy: </span>
          <div className={`sb-md break-words select-text ${streaming ? 'is-streaming' : ''}`}>
            {message.text === '' && streaming ? (
              <span className="sb-caret" aria-hidden />
            ) : (
              <Markdown text={withoutAnnotations(message.text)} />
            )}
          </div>
          {message.state === 'stopped' && (
            <p className="mt-1 text-[11px] text-ink-faint">Stopped</p>
          )}
          {message.truncated === true && (
            <p className="mt-1 text-[11px] text-ink-faint">
              The answer reached the length limit. Ask “continue” for more.
            </p>
          )}
          <ReadAloud message={message} />
        </div>
      )}
    </motion.li>
  )
}
