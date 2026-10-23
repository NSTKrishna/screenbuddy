import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react'
import { ArrowUp, LoaderCircle, MapPinX, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { bridge } from '../lib/bridge'
import { destinationOf } from '../lib/destination'
import { useAnnotationStore } from '../stores/useAnnotationStore'
import { UPLOAD_TYPES, useCaptureStore } from '../stores/useCaptureStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useChatStore } from '../stores/useChatStore'
import { useUiStore } from '../stores/useUiStore'
import { useVoiceStore } from '../stores/useVoiceStore'
import { AttachmentPreview } from './AttachmentPreview'
import { CaptureControls } from './CaptureControls'
import { CaptureNotice } from './CaptureNotice'
import { VoiceButton } from './VoiceButton'
import { ListeningRow, SpeechBar, TranscribingRow, VoiceNotice } from './VoicePanels'

const MAX_TEXTAREA_HEIGHT = 120

function CapturingRow() {
  const cancel = useCaptureStore((s) => s.cancel)
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-line bg-black/20 px-2.5 py-2"
      role="status"
    >
      <LoaderCircle className="size-3.5 animate-spin text-aurora-1" strokeWidth={2.2} aria-hidden />
      <span className="flex-1 text-[12px] text-ink-muted">Capturing screen…</span>
      <button
        type="button"
        onClick={cancel}
        className="rounded-md px-2 py-0.5 text-[12px] text-ink-muted hover:bg-surface-hover hover:text-ink"
      >
        Cancel
      </button>
    </div>
  )
}

export function ChatInput() {
  const draft = useChatStore((s) => s.draft)
  const status = useChatStore((s) => s.status)
  const setDraft = useChatStore((s) => s.setDraft)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const captureStatus = useCaptureStore((s) => s.status)
  const hasAttachment = useCaptureStore((s) => s.attachment !== null)
  const failure = useCaptureStore((s) => s.failure)
  const importFile = useCaptureStore((s) => s.importFile)
  const focusRequest = useUiStore((s) => s.focusRequest)
  const destination = destinationOf(useSettingsStore((s) => s.settings))
  const voiceMode = useSettingsStore((s) => s.settings?.voice.mode !== 'text')
  const voicePhase = useVoiceStore((s) => s.phase)
  const annotationsVisible = useAnnotationStore((s) => s.visible)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  const listening = voicePhase === 'listening' || voicePhase === 'requesting'
  const transcribing = voicePhase === 'transcribing'
  const busy = status === 'thinking' || status === 'responding'
  const capturing = captureStatus === 'capturing'
  const canSend =
    (draft.trim() !== '' || hasAttachment) && !busy && !capturing && !listening && !transcribing

  // Grow with the text up to a few lines, then scroll.
  useLayoutEffect(() => {
    const el = textarea.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [draft, listening])

  useEffect(() => {
    if (!listening && !transcribing) textarea.current?.focus()
  }, [focusRequest, listening, transcribing, hasAttachment])

  const submit = (e?: SyntheticEvent): void => {
    e?.preventDefault()
    if (canSend) send(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    // Reset so choosing the same file again still fires a change.
    e.target.value = ''
    if (file !== undefined) void importFile(file)
  }

  const pickImage = (): void => filePicker.current?.click()

  return (
    <form onSubmit={submit} className="px-3 pt-1 pb-3">
      <input
        ref={filePicker}
        type="file"
        accept={UPLOAD_TYPES.join(',')}
        className="hidden"
        onChange={onFileChosen}
        data-testid="image-picker"
      />
      <AnimatePresence>
        {failure !== null && <CaptureNotice key={failure.code} onPickImage={pickImage} />}
      </AnimatePresence>
      <VoiceNotice />
      <SpeechBar />
      <div
        className={`flex flex-col gap-1.5 rounded-2xl border bg-surface-raised p-1.5 transition-colors duration-200 ${
          listening ? 'border-danger/45' : 'border-line focus-within:border-line-strong'
        }`}
      >
        {capturing && <CapturingRow />}
        <AttachmentPreview />
        <AnimatePresence mode="popLayout" initial={false}>
          {listening ? (
            <motion.div
              key="listening"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ListeningRow />
            </motion.div>
          ) : transcribing ? (
            <motion.div
              key="transcribing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <TranscribingRow />
            </motion.div>
          ) : (
            <motion.textarea
              key="text"
              ref={textarea}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={hasAttachment ? 'Ask about this image…' : 'Ask anything…'}
              aria-label="Message ScreenBuddy"
              maxLength={4000}
              className="thin-scrollbar min-h-8 resize-none bg-transparent px-2 py-[7px] text-[13.5px] leading-[18px] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <div className="flex items-center gap-1">
          <CaptureControls onPickImage={pickImage} disabled={busy} />
          <span className="flex-1" />
          {annotationsVisible && (
            <button
              type="button"
              onClick={() => void bridge().annotations.clear()}
              title="Clear annotations (Esc)"
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <MapPinX className="size-3.5" strokeWidth={2} aria-hidden />
              Clear annotations
            </button>
          )}
          {voiceMode && <VoiceButton />}
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop response"
              title="Stop response"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-ink text-[#111218] transition-transform duration-150 active:scale-95"
            >
              <Square className="size-3" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              title="Send (Enter)"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-ink text-[#111218] transition-[opacity,transform] duration-150 active:scale-95 disabled:bg-surface-hover disabled:text-ink-faint"
            >
              <ArrowUp className="size-4" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[10.5px] text-ink-faint">
        {destination.mock
          ? 'Mock mode: nothing leaves this Mac · ⏎ to send'
          : `${destination.model} via ${destination.host} · ⏎ to send · ⇧⏎ new line`}
      </p>
    </form>
  )
}
