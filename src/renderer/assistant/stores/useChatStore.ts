import { create } from 'zustand'
import type { ChatError, ChatEvent, ChatProgressStage, HistoryMessage } from '@shared/schemas/chat'
import type { CaptureResult } from '@shared/schemas/capture'
import { bridge } from '../lib/bridge'
import { isScreenQuestion } from '../lib/screenIntent'
import { useCaptureStore } from './useCaptureStore'
import { useSettingsStore } from './useSettingsStore'

export type ChatStatus = 'idle' | 'thinking' | 'responding' | 'error'

/** A description of an attached image. The image itself is never kept in the conversation. */
export interface AttachmentMeta {
  source: 'screen' | 'upload' | 'earlier'
  label: string
  width?: number
  height?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  state: 'streaming' | 'done' | 'stopped'
  /** The answer hit the model's length limit. */
  truncated?: boolean
  attachment?: AttachmentMeta
  /** User message: asked by voice. Assistant message: answers a spoken question. */
  viaVoice?: boolean
}

export interface ChatProgress {
  stage: ChatProgressStage
  attempt: number
  maxAttempts: number
  /** Whether a screenshot went with the question, for the progress label. */
  withImage: boolean
}

export interface FailedTurn extends ChatError {
  /** Whether the failed question still carries a screenshot. */
  hadImage: boolean
}

interface ChatState {
  status: ChatStatus
  messages: ChatMessage[]
  /** The turn main is answering; events for any other turn are ignored. */
  activeTurnId: string | null
  /** Whether the active turn's question was spoken. */
  activeViaVoice: boolean
  progress: ChatProgress | null
  error: FailedTurn | null
  draft: string
  /** The draft came from a transcript (editing it keeps that, clearing it resets it). */
  draftViaVoice: boolean
  /** A short, dismissible hint. */
  notice: string | null
  /**
   * True once a screenshot has been offered for the current draft, so pressing
   * Send again sends it as is instead of capturing a second time.
   */
  autoCaptureOffered: boolean

  setDraft: (draft: string, viaVoice?: boolean) => void
  send: (text: string) => void
  stop: () => void
  retry: (withoutImage?: boolean) => void
  newChat: () => void
  handleEvent: (event: ChatEvent) => void
  loadHistory: () => Promise<void>
  dismissNotice: () => void
}

const MAX_PROMPT_LENGTH = 4000

let nextId = 0

function makeId(): string {
  nextId += 1
  return `m${Date.now().toString(36)}${nextId}`
}

function describe(capture: CaptureResult): AttachmentMeta {
  return {
    source: capture.source,
    label: capture.label,
    width: capture.width,
    height: capture.height,
  }
}

function fromHistory(m: HistoryMessage): ChatMessage {
  return {
    id: makeId(),
    role: m.role,
    text: m.text,
    state: 'done',
    ...(m.hadImage
      ? { attachment: { source: 'earlier' as const, label: 'Screenshot (not kept)' } }
      : {}),
  }
}

const BRIDGE_FAILURE: FailedTurn = {
  code: 'BUSY',
  message: 'ScreenBuddy couldn’t start that request.',
  retryable: false,
  hadImage: false,
}

/**
 * The conversation as the UI shows it. Main owns the real conversation and
 * the requests (D-013); this store mirrors it from `chat:event`s.
 */
export const useChatStore = create<ChatState>()((set, get) => {
  const lastUser = (): ChatMessage | undefined => get().messages.findLast((m) => m.role === 'user')

  const begin = (turnId: string, withImage: boolean, viaVoice: boolean): void => {
    set({
      status: 'thinking',
      activeTurnId: turnId,
      activeViaVoice: viaVoice,
      error: null,
      progress: { stage: 'connecting', attempt: 1, maxAttempts: 1, withImage },
    })
  }

  const rejected = (turnId: string, error: ChatError): void => {
    if (get().activeTurnId !== turnId) return
    set({
      status: 'error',
      activeTurnId: null,
      progress: null,
      error: { ...error, hadImage: false },
    })
  }

  return {
    status: 'idle',
    messages: [],
    activeTurnId: null,
    activeViaVoice: false,
    progress: null,
    error: null,
    draft: '',
    draftViaVoice: false,
    notice: null,
    autoCaptureOffered: false,

    setDraft: (draft, viaVoice) =>
      set((s) => ({
        draft,
        draftViaVoice: viaVoice ?? (draft === '' ? false : s.draftViaVoice),
        autoCaptureOffered: false,
      })),

    send: (text) => {
      const prompt = text.trim().slice(0, MAX_PROMPT_LENGTH)
      const { status, autoCaptureOffered, draftViaVoice } = get()
      if (status === 'thinking' || status === 'responding') return
      const capture = useCaptureStore.getState()
      if (capture.status === 'capturing') return
      // An attachment can go on its own; otherwise there must be some text.
      if (prompt === '' && capture.attachment === null) return

      // A clear screen question gets a screenshot, but only for review: the
      // message waits until the user presses Send again (D-030).
      const autoCapture = useSettingsStore.getState().settings?.autoCaptureScreenQuestions === true
      if (
        autoCapture &&
        !autoCaptureOffered &&
        capture.attachment === null &&
        isScreenQuestion(prompt)
      ) {
        set({ autoCaptureOffered: true, notice: null })
        void capture.capture('question').then((attached) => {
          if (attached) {
            set({ notice: 'Screenshot attached. Check it, then press Send to include it.' })
          }
        })
        return
      }

      // Main now owns the image and frees it once the request completes (D-032).
      const attachment = capture.takeForSend()
      const message: ChatMessage = { id: makeId(), role: 'user', text: prompt, state: 'done' }
      if (attachment !== null) message.attachment = describe(attachment)
      if (draftViaVoice) message.viaVoice = true
      const turnId = crypto.randomUUID()
      set((s) => ({
        draft: '',
        draftViaVoice: false,
        notice: null,
        autoCaptureOffered: false,
        messages: [...s.messages, message],
      }))
      begin(turnId, attachment !== null, draftViaVoice)
      bridge()
        .chat.send({ turnId, text: prompt, captureId: attachment?.captureId ?? null })
        .then((result) => {
          if (!result.accepted) rejected(turnId, result.error)
        })
        .catch(() => {
          rejected(turnId, BRIDGE_FAILURE)
        })
    },

    stop: () => {
      const { activeTurnId } = get()
      if (activeTurnId !== null) void bridge().chat.cancel(activeTurnId)
    },

    retry: (withoutImage = false) => {
      const { error } = get()
      if (error === null) return
      if (withoutImage) {
        // The question goes again as text only, so its chip no longer applies.
        const target = lastUser()
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m !== target) return m
            const { attachment: _dropped, ...rest } = m
            return rest
          }),
        }))
      }
      const turnId = crypto.randomUUID()
      begin(turnId, error.hadImage && !withoutImage, lastUser()?.viaVoice === true)
      bridge()
        .chat.retry({ turnId, withoutImage })
        .then((result) => {
          if (!result.accepted) rejected(turnId, result.error)
        })
        .catch(() => {
          rejected(turnId, BRIDGE_FAILURE)
        })
    },

    newChat: () => {
      void bridge().chat.reset()
      useCaptureStore.getState().remove()
      set({
        status: 'idle',
        messages: [],
        activeTurnId: null,
        activeViaVoice: false,
        progress: null,
        error: null,
        draft: '',
        draftViaVoice: false,
        notice: null,
        autoCaptureOffered: false,
      })
    },

    handleEvent: (event) => {
      if (event.turnId !== get().activeTurnId) return
      switch (event.type) {
        case 'progress':
          set((s) => ({
            progress: {
              stage: event.stage,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              withImage: s.progress?.withImage ?? false,
            },
          }))
          break
        case 'started':
          set((s) => ({
            status: 'responding',
            progress: null,
            messages: [
              ...s.messages,
              {
                id: event.turnId,
                role: 'assistant',
                text: '',
                state: 'streaming',
                ...(s.activeViaVoice ? { viaVoice: true } : {}),
              },
            ],
          }))
          break
        case 'delta':
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === event.turnId ? { ...m, text: m.text + event.text } : m,
            ),
          }))
          break
        case 'done': {
          const state = event.stopped ? ('stopped' as const) : ('done' as const)
          set((s) => {
            const exists = s.messages.some((m) => m.id === event.turnId)
            const messages: ChatMessage[] = exists
              ? s.messages.map((m) =>
                  m.id === event.turnId ? { ...m, state, truncated: event.truncated } : m,
                )
              : // Stopped before the first word: still show that it was stopped.
                [...s.messages, { id: event.turnId, role: 'assistant', text: '', state }]
            return { status: 'idle', activeTurnId: null, progress: null, messages }
          })
          break
        }
        case 'error': {
          const hadImage = lastUser()?.attachment !== undefined
          set((s) => ({
            status: 'error',
            activeTurnId: null,
            progress: null,
            // Drop a half-streamed answer; Retry produces a fresh one.
            messages: s.messages.filter((m) => m.id !== event.turnId),
            error: { ...event.error, hadImage },
          }))
          break
        }
      }
    },

    loadHistory: async () => {
      const { messages } = await bridge().chat.history()
      if (messages.length > 0 && get().messages.length === 0) {
        set({ messages: messages.map(fromHistory) })
      }
    },

    dismissNotice: () => set({ notice: null }),
  }
})
