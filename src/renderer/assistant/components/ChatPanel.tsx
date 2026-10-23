import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { progressLabel } from '../lib/progressLabel'
import { useCaptureStore } from '../stores/useCaptureStore'
import { useChatStore } from '../stores/useChatStore'
import { useUiStore } from '../stores/useUiStore'
import { AttachmentLightbox } from './AttachmentPreview'
import { ChatInput } from './ChatInput'
import { ChatMessage } from './ChatMessage'
import { EmptyState } from './EmptyState'
import { ErrorNotice } from './ErrorNotice'
import { HeaderControls } from './HeaderControls'
import { ThinkingIndicator } from './Indicators'
import { SettingsView } from './SettingsView'

/** Distance from the bottom (px) within which new content keeps the list pinned. */
const STICK_THRESHOLD = 48

function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const error = useChatStore((s) => s.error)
  const notice = useChatStore((s) => s.notice)
  const retry = useChatStore((s) => s.retry)
  const progress = useChatStore((s) => s.progress)
  const setView = useUiStore((s) => s.setView)
  const dismissNotice = useChatStore((s) => s.dismissNotice)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const lastText = messages.at(-1)?.text

  // Follow the stream unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages.length, lastText, status, error])

  const empty = messages.length === 0 && status !== 'thinking' && error === null

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
      }}
      className="thin-scrollbar relative min-h-0 flex-1 overflow-y-auto"
    >
      {empty ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-full flex-col justify-end gap-3 px-4 pt-4 pb-3">
          <ol
            className="flex flex-col gap-3"
            role="log"
            aria-label="Conversation"
            aria-busy={status === 'responding'}
          >
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}
          </ol>
          {status === 'thinking' && <ThinkingIndicator label={progressLabel(progress)} />}
          {error !== null && status === 'error' && (
            <ErrorNotice
              error={error}
              onRetry={() => retry()}
              onRetryWithoutImage={() => retry(true)}
              onOpenSettings={() => setView('settings')}
            />
          )}
        </div>
      )}
      <AnimatePresence>
        {notice !== null && (
          <motion.div
            role="status"
            className="sticky bottom-2 mx-3 flex items-start gap-2 rounded-xl border border-line bg-[#1d1e26] px-3 py-2 text-[12px] leading-snug text-ink-muted shadow-lg"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismissNotice}
              className="-m-0.5 rounded p-0.5 text-ink-faint hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The expanded assistant: header, conversation (or settings) and input. */
export function ChatPanel() {
  const view = useUiStore((s) => s.view)
  const importFile = useCaptureStore((s) => s.importFile)
  // A new screenshot flashes the panel, so a capture is never silent (SECURITY.md §7).
  const flashId = useCaptureStore((s) =>
    s.attachment?.source === 'screen' ? s.attachment.captureId : null,
  )
  const [dragging, setDragging] = useState(false)

  const carriesFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!carriesFiles(e) || view !== 'chat') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file !== undefined && view === 'chat') void importFile(file)
  }

  return (
    <motion.section
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        // Only when the pointer leaves the panel, not when it crosses a child.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
      aria-label="ScreenBuddy assistant"
      className="glass-panel absolute inset-2 flex flex-col overflow-hidden rounded-[20px]"
      style={{ transformOrigin: 'bottom right' }}
      initial={{ opacity: 0, scale: 0.55, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{
        opacity: 0,
        scale: 0.55,
        y: 10,
        transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.8 }}
    >
      <HeaderControls />
      <AnimatePresence mode="wait" initial={false}>
        {view === 'settings' ? (
          <SettingsView key="settings" />
        ) : (
          <motion.div
            key="chat"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <MessageList />
            <ChatInput />
          </motion.div>
        )}
      </AnimatePresence>
      <AttachmentLightbox />
      <AnimatePresence>
        {flashId !== null && (
          <motion.div
            key={flashId}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-50 bg-white"
            initial={{ opacity: 0.28 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dragging && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-aurora-1/50 bg-[#0d0e12]/85 text-[13px] text-ink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ImagePlus className="size-6 text-aurora-1" strokeWidth={1.8} />
            Drop a PNG or JPEG to attach it
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
