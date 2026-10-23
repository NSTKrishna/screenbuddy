import { create } from 'zustand'
import { MAX_AUDIO_BYTES } from '@shared/limits'
import type { MicPermissionInfo, VoiceError, VoiceErrorCode } from '@shared/schemas/voice'
import { bridge } from '../lib/bridge'
import {
  MicrophoneError,
  startRecording,
  type ActiveRecording,
  type FinishedRecording,
} from '../lib/audio/recorder'
import {
  ProviderSpeechEngine,
  SpeechEngineError,
  SystemSpeechEngine,
  type SpeechEngine,
} from '../lib/speech/engines'
import { spokenText } from '../lib/speech/spokenText'
import { useChatStore } from './useChatStore'
import { useSettingsStore } from './useSettingsStore'

/**
 * idle → requesting (permission) → listening → transcribing → idle, and
 * idle → speaking → idle for spoken answers. Thinking/responding live in
 * the chat store; the UI combines both.
 */
export type VoicePhase = 'idle' | 'requesting' | 'listening' | 'transcribing' | 'speaking'

const LOCAL_MESSAGES: Partial<Record<VoiceErrorCode, string>> = {
  MIC_DENIED: 'ScreenBuddy doesn’t have access to the microphone.',
  MIC_UNAVAILABLE: 'No microphone was found. Connect one, or type your question instead.',
  MIC_BUSY: 'The microphone is in use by another app.',
  NO_SPEECH: 'I didn’t hear anything, so nothing was sent.',
}

function localError(code: VoiceErrorCode): VoiceError {
  return { code, message: LOCAL_MESSAGES[code] ?? 'Something went wrong.', retryable: false }
}

const WAVE_POINTS = 36

interface VoiceState {
  phase: VoicePhase
  /** Recent microphone levels for the waveform, oldest first. */
  levels: number[]
  elapsedMs: number
  /** Live transcript while a streaming transcription runs. */
  partial: string
  error: VoiceError | null
  /** Microphone permission details, for the guidance card. */
  permission: MicPermissionInfo | null
  /** The message being read aloud. */
  speakingId: string | null
  /** A gentle one-line note, such as "used the system voice instead". */
  notice: string | null
  /** A failed transcription's audio, kept in memory only so Retry can resend it. */
  canRetry: boolean

  toggleListening: () => void
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  /** Esc: undo whatever voice is doing right now. */
  cancel: () => void
  retryTranscription: () => void
  dismissError: () => void
  handlePartial: (requestId: string, text: string) => void
  speak: (messageId: string, markdown: string) => Promise<void>
  stopSpeaking: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  /** The window was dismissed: nothing listens or speaks while hidden. */
  onHidden: () => void
}

let recording: ActiveRecording | null = null
let transcribeId: string | null = null
let retained: FinishedRecording | null = null
let engine: SpeechEngine | null = null
let engineKind: 'system' | 'provider' | null = null

const voiceSettings = () => useSettingsStore.getState().settings?.voice

function engineFor(kind: 'system' | 'provider'): SpeechEngine {
  if (engine === null || engineKind !== kind) {
    engine?.stop()
    engine = kind === 'system' ? new SystemSpeechEngine() : new ProviderSpeechEngine()
    engineKind = kind
  }
  return engine
}

export const useVoiceStore = create<VoiceState>()((set, get) => {
  const transcribe = async (clip: FinishedRecording): Promise<void> => {
    const requestId = crypto.randomUUID()
    transcribeId = requestId
    set({ phase: 'transcribing', partial: '', error: null, canRetry: false })
    let outcome
    try {
      // A fresh copy each time: main zero-fills what it receives.
      const bytes = new Uint8Array(await clip.blob.arrayBuffer())
      outcome = await bridge().voice.transcribe({
        requestId,
        mimeType: clip.mimeType,
        bytes,
        durationMs: Math.min(clip.durationMs, 120_000),
      })
    } catch {
      outcome = {
        status: 'failed' as const,
        error: {
          code: 'PROVIDER_ERROR' as const,
          message: 'Transcription failed.',
          retryable: true,
        },
      }
    }
    if (transcribeId !== requestId) return // canceled or superseded
    transcribeId = null

    if (outcome.status === 'failed') {
      if (outcome.error.code === 'CANCELED') {
        retained = null
        set({ phase: 'idle', partial: '' })
        return
      }
      retained = outcome.error.retryable ? clip : null
      set({ phase: 'idle', partial: '', error: outcome.error, canRetry: retained !== null })
      return
    }

    retained = null
    const text = outcome.text.trim()
    if (text === '') {
      set({ phase: 'idle', partial: '', error: localError('NO_SPEECH') })
      return
    }
    const chat = useChatStore.getState()
    const draft = chat.draft.trim() === '' ? text : `${chat.draft.trimEnd()} ${text}`
    chat.setDraft(draft, true)
    set({ phase: 'idle', partial: '' })
    if (voiceSettings()?.autoSend === true) useChatStore.getState().send(draft)
  }

  return {
    phase: 'idle',
    levels: [],
    elapsedMs: 0,
    partial: '',
    error: null,
    permission: null,
    speakingId: null,
    notice: null,
    canRetry: false,

    toggleListening: () => {
      const { phase } = get()
      if (phase === 'listening') void get().stopListening()
      else if (phase === 'idle' || phase === 'speaking') void get().startListening()
    },

    startListening: async () => {
      if (voiceSettings()?.mode === 'text') return
      // Never listen while speaking: that would record our own voice.
      get().stopSpeaking()
      const chat = useChatStore.getState()
      // A new spoken question interrupts an answer that's still streaming.
      if (chat.status === 'thinking' || chat.status === 'responding') chat.stop()
      retained = null
      set({
        phase: 'requesting',
        error: null,
        notice: null,
        canRetry: false,
        levels: [],
        elapsedMs: 0,
      })

      const permission = await bridge().voice.begin()
      set({ permission })
      if (get().phase !== 'requesting') return // canceled meanwhile
      if (permission.status !== 'granted') {
        void bridge().voice.end()
        set({ phase: 'idle', error: localError('MIC_DENIED') })
        return
      }
      try {
        recording = await startRecording({
          onLevel: (level, elapsedMs) => {
            set((s) => ({
              levels: [...s.levels, Math.min(1, level * 6)].slice(-WAVE_POINTS),
              elapsedMs,
            }))
          },
          onAutoStop: () => {
            void get().stopListening()
          },
        })
      } catch (error) {
        void bridge().voice.end()
        const code = error instanceof MicrophoneError ? error.code : 'MIC_UNAVAILABLE'
        set({ phase: 'idle', error: localError(code) })
        return
      }
      if (get().phase !== 'requesting') {
        recording.cancel()
        recording = null
        void bridge().voice.end()
        return
      }
      set({ phase: 'listening' })
    },

    stopListening: async () => {
      const active = recording
      if (active === null || get().phase !== 'listening') return
      recording = null
      const clip = await active.stop()
      void bridge().voice.end()
      // Silence or a click is never sent anywhere.
      if (!clip.heardSpeech || clip.blob.size === 0) {
        set({ phase: 'idle', levels: [], error: localError('NO_SPEECH') })
        return
      }
      if (clip.blob.size > MAX_AUDIO_BYTES) {
        set({
          phase: 'idle',
          levels: [],
          error: { ...localError('NO_SPEECH'), message: 'That recording is too long to send.' },
        })
        return
      }
      set({ levels: [] })
      await transcribe(clip)
    },

    cancel: () => {
      const { phase } = get()
      if (phase === 'listening' || phase === 'requesting') {
        recording?.cancel()
        recording = null
        void bridge().voice.end()
        set({ phase: 'idle', levels: [] })
      } else if (phase === 'transcribing') {
        if (transcribeId !== null) void bridge().voice.cancelTranscription(transcribeId)
        transcribeId = null
        retained = null
        set({ phase: 'idle', partial: '' })
      } else if (phase === 'speaking') {
        get().stopSpeaking()
      }
    },

    retryTranscription: () => {
      const clip = retained
      if (clip === null || get().phase !== 'idle') return
      void transcribe(clip)
    },

    dismissError: () => {
      retained = null
      set({ error: null, canRetry: false })
    },

    handlePartial: (requestId, text) => {
      if (requestId === transcribeId) set({ partial: text })
    },

    speak: async (messageId, markdown) => {
      const voice = voiceSettings()
      if (voice === undefined || voice.mode === 'text') return
      const text = spokenText(markdown)
      if (text === '') return
      // Never speak over an open microphone.
      if (get().phase === 'listening' || get().phase === 'requesting') return
      engine?.stop()
      set({ phase: 'speaking', speakingId: messageId, notice: null })
      const options = {
        volume: voice.volume,
        rate: voice.rate,
        voiceName: voice.speech.systemVoice,
      }
      try {
        await engineFor(voice.speech.engine).speak(text, options)
      } catch (error) {
        // The provider voice failed (offline, no key): fall back to the system voice.
        if (voice.speech.engine === 'provider' && get().speakingId === messageId) {
          set({
            notice:
              error instanceof SpeechEngineError
                ? `${error.error.message} Using the system voice instead.`
                : 'The provider voice failed; using the system voice instead.',
          })
          try {
            await engineFor('system').speak(text, options)
          } catch {
            // Nothing more to try; the answer is on screen.
          }
        }
      } finally {
        if (get().speakingId === messageId) set({ phase: 'idle', speakingId: null })
      }
    },

    stopSpeaking: () => {
      engine?.stop()
      if (get().phase === 'speaking') set({ phase: 'idle', speakingId: null })
    },

    setVolume: (volume) => {
      engine?.setVolume(volume)
      void useSettingsStore.getState().update({ voice: { volume } })
    },

    toggleMute: () => {
      const speakResponses = !(voiceSettings()?.speakResponses ?? true)
      if (!speakResponses) get().stopSpeaking()
      void useSettingsStore.getState().update({ voice: { speakResponses } })
    },

    onHidden: () => {
      get().cancel()
      get().stopSpeaking()
      retained = null
      set({ canRetry: false })
    },
  }
})

/**
 * Reads an answer aloud when it finishes, if the question was spoken and
 * spoken answers are on. Call once at startup; returns an unsubscribe.
 */
export function speakAnswersToSpokenQuestions(): () => void {
  return useChatStore.subscribe((state, previous) => {
    const voice = voiceSettings()
    if (voice?.mode !== 'voice' || !voice.speakResponses) return
    const finished = state.messages.find(
      (m) =>
        m.role === 'assistant' &&
        m.viaVoice === true &&
        m.state === 'done' &&
        previous.messages.some((p) => p.id === m.id && p.state === 'streaming'),
    )
    if (finished !== undefined) void useVoiceStore.getState().speak(finished.id, finished.text)
  })
}
