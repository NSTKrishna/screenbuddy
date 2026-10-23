import type { SpeakOutcome, VoiceSettings } from '@shared/schemas/voice'
import { SpeechAudioType } from '@shared/schemas/voice'
import { MAX_AUDIO_BYTES } from '@shared/limits'
import type { FetchLike } from '../ai/OpenAiCompatibleProvider'
import { classifyHttpError } from '../ai/OpenAiCompatibleProvider'
import { ProviderError } from '../ai/types'
import {
  credentialsProblem,
  voiceError,
  voiceErrorFrom,
  type ProviderCredentials,
} from './SpeechToTextService'

export interface TextToSpeechDeps {
  voice: () => VoiceSettings
  credentials: () => ProviderCredentials
  fetch: FetchLike
  timeoutMs?: number
  log?: (message: string) => void
}

/**
 * Provider text-to-speech via OpenAI-compatible `/audio/speech` (D-009,
 * optional engine). The default system voice runs in the renderer and never
 * touches the network.
 */
export class TextToSpeechService {
  constructor(private readonly deps: TextToSpeechDeps) {}

  async speak(text: string): Promise<SpeakOutcome> {
    const credentials = this.deps.credentials()
    if (credentials.ai.provider === 'mock') {
      return { status: 'failed', error: voiceError('NOT_CONFIGURED') }
    }
    const problem = credentialsProblem(credentials)
    if (problem !== null) return { status: 'failed', error: problem }

    const voice = this.deps.voice()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 30_000)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (credentials.apiKey !== null) headers.Authorization = `Bearer ${credentials.apiKey}`
    try {
      let res: Response
      try {
        res = await this.deps.fetch(`${credentials.ai.baseUrl}/audio/speech`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: voice.speech.providerModel,
            voice: voice.speech.providerVoice,
            input: text,
            response_format: 'mp3',
            speed: voice.rate,
          }),
          signal: controller.signal,
        })
      } catch {
        if (controller.signal.aborted) return { status: 'failed', error: voiceError('TIMEOUT') }
        return { status: 'failed', error: voiceError('PROVIDER_UNAVAILABLE') }
      }
      if (!res.ok) {
        const error =
          res.status === 404
            ? new ProviderError('MODEL_NOT_FOUND', false)
            : classifyHttpError(res.status, { code: '', message: '' }, false)
        return { status: 'failed', error: voiceErrorFrom(error) }
      }
      const type = SpeechAudioType.safeParse((res.headers.get('content-type') ?? '').split(';')[0])
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (!type.success || bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
        return { status: 'failed', error: voiceError('PROVIDER_ERROR') }
      }
      return { status: 'ok', mimeType: type.data, bytes }
    } catch {
      return {
        status: 'failed',
        error: voiceError(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_ERROR'),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
