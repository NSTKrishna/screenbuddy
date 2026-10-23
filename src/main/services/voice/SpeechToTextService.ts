import { checkBaseUrl, isLocalBaseUrl } from '@shared/baseUrl'
import type { AiConfig } from '@shared/schemas/settings'
import type {
  TranscribeOutcome,
  TranscribeRequest,
  VoiceError,
  VoiceErrorCode,
  VoiceEvent,
  VoiceSettings,
} from '@shared/schemas/voice'
import { ProviderError } from '../ai/types'
import type { TranscriptionProvider } from './transcription'

const MESSAGES: Record<VoiceErrorCode, string> = {
  MIC_DENIED: 'ScreenBuddy doesn’t have access to the microphone.',
  MIC_UNAVAILABLE: 'No microphone was found.',
  MIC_BUSY: 'The microphone is in use by another app.',
  NO_SPEECH: 'I didn’t hear anything. Nothing was sent.',
  NOT_CONFIGURED:
    'Speech-to-text needs an AI provider. Set one up in Settings, or switch transcription to mock.',
  INVALID_API_KEY: 'The provider rejected the API key. Check it in Settings.',
  PROVIDER_UNAVAILABLE: 'Couldn’t reach the transcription service. Check your connection.',
  RATE_LIMITED: 'The provider is limiting requests. Wait a moment, then try again.',
  TIMEOUT: 'Transcription took too long.',
  UNSUPPORTED:
    'This provider or model doesn’t do speech-to-text. Check the transcription model in Settings, or use mock transcription.',
  BAD_REQUEST: 'The provider couldn’t process that recording.',
  PROVIDER_ERROR: 'The transcription service had a problem. Try again.',
  BUSY: 'A transcription is already running.',
  CANCELED: 'Transcription canceled.',
}

const RETRYABLE = new Set<VoiceErrorCode>([
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'INVALID_API_KEY',
  'NOT_CONFIGURED',
])

export function voiceError(code: VoiceErrorCode, message: string = MESSAGES[code]): VoiceError {
  return { code, message, retryable: RETRYABLE.has(code) }
}

/** Maps a provider failure (shared with chat) onto speech error codes. */
export function voiceErrorFrom(error: unknown): VoiceError {
  if (!(error instanceof ProviderError)) return voiceError('PROVIDER_ERROR')
  switch (error.code) {
    case 'INVALID_API_KEY':
    case 'PROVIDER_UNAVAILABLE':
    case 'RATE_LIMITED':
    case 'TIMEOUT':
    case 'BAD_REQUEST':
    case 'PROVIDER_ERROR':
      return voiceError(error.code)
    case 'MODEL_NOT_FOUND':
      return voiceError('UNSUPPORTED')
    default:
      return voiceError('PROVIDER_ERROR')
  }
}

export interface ProviderCredentials {
  ai: AiConfig
  apiKey: string | null
}

/** A provider configured enough to talk to; shared with text-to-speech. */
export function credentialsProblem({ ai, apiKey }: ProviderCredentials): VoiceError | null {
  if (!checkBaseUrl(ai.baseUrl).ok) return voiceError('NOT_CONFIGURED')
  if (apiKey === null && !isLocalBaseUrl(ai.baseUrl)) return voiceError('NOT_CONFIGURED')
  return null
}

export interface SpeechToTextDeps {
  voice: () => VoiceSettings
  credentials: () => ProviderCredentials
  /** `mock` for the free provider; otherwise the AI provider's endpoint. */
  providerFor: (
    kind: 'mock' | 'provider',
    credentials: ProviderCredentials,
  ) => TranscriptionProvider
  emit: (event: VoiceEvent) => void
  timeoutMs?: number
  log?: (message: string) => void
}

/**
 * Turns one recording into text (ARCHITECTURE.md §6.6). It runs only when the
 * renderer sends a recording the user made, and keeps nothing: the audio
 * buffer is zero-filled once the request ends, however it ends.
 */
export class SpeechToTextService {
  private active: { requestId: string; controller: AbortController } | null = null
  private readonly log: (message: string) => void

  constructor(private readonly deps: SpeechToTextDeps) {
    this.log = deps.log ?? (() => undefined)
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeOutcome> {
    if (this.active !== null) {
      request.bytes.fill(0)
      return { status: 'failed', error: voiceError('BUSY') }
    }
    const controller = new AbortController()
    this.active = { requestId: request.requestId, controller }
    // Set from callbacks and timers, so kept in one object rather than narrowed locals.
    const state = { timedOut: false, partials: false }
    const aborted = (): boolean => controller.signal.aborted
    const timer = setTimeout(() => {
      state.timedOut = true
      controller.abort()
    }, this.deps.timeoutMs ?? 45_000)

    try {
      const voice = this.deps.voice()
      const credentials = this.deps.credentials()
      const useMock = voice.transcription.source === 'mock' || credentials.ai.provider === 'mock'
      if (!useMock) {
        const problem = credentialsProblem(credentials)
        if (problem !== null) return { status: 'failed', error: problem }
      }
      const provider = this.deps.providerFor(useMock ? 'mock' : 'provider', credentials)
      const attempt = (): Promise<string> =>
        provider.transcribe(
          { bytes: request.bytes, mimeType: request.mimeType, durationMs: request.durationMs },
          {
            signal: controller.signal,
            model: voice.transcription.model,
            language: voice.transcription.language,
            stream: voice.transcription.stream,
            onPartial: (text) => {
              state.partials = true
              this.deps.emit({ type: 'partial', requestId: request.requestId, text })
            },
          },
        )

      let text: string
      try {
        text = await attempt()
      } catch (error) {
        // One quick retry for a transient failure, unless words have already been shown.
        const transient = error instanceof ProviderError && error.retryable
        if (!transient || state.partials || aborted()) throw error
        this.log('voice: transcription failed, retrying once')
        await new Promise((r) => setTimeout(r, 500))
        if (aborted()) throw error
        text = await attempt()
      }
      return { status: 'ok', text: text.trim().slice(0, 10_000) }
    } catch (error) {
      if (aborted()) {
        return { status: 'failed', error: voiceError(state.timedOut ? 'TIMEOUT' : 'CANCELED') }
      }
      const e = voiceErrorFrom(error)
      this.log(`voice: transcription failed (${e.code})`)
      return { status: 'failed', error: e }
    } finally {
      clearTimeout(timer)
      request.bytes.fill(0)
      this.active = null
    }
  }

  cancel(requestId: string): void {
    if (this.active?.requestId === requestId) this.active.controller.abort()
  }
}
