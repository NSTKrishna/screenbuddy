import type { AudioMimeType } from '@shared/schemas/voice'
import {
  classifyHttpError,
  parseRetryAfter,
  type FetchLike,
  type OpenAiCompatibleConfig,
} from '../ai/OpenAiCompatibleProvider'
import { SseParser } from '../ai/sse'
import { ProviderError } from '../ai/types'
import { multipartBody } from './multipart'

export interface AudioClip {
  bytes: Uint8Array
  mimeType: AudioMimeType
  durationMs: number
}

export interface TranscribeOptions {
  signal: AbortSignal
  model: string
  /** ISO-639-1, or empty to let the model detect it. */
  language: string
  /** Ask for partial results as they're produced. */
  stream: boolean
  /** The transcript so far. */
  onPartial: (textSoFar: string) => void
}

/** A speech-to-text backend. Like ChatProvider, it knows one wire format and nothing else. */
export interface TranscriptionProvider {
  readonly name: string
  transcribe: (clip: AudioClip, options: TranscribeOptions) => Promise<string>
}

const EXTENSIONS: Record<AudioMimeType, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
}

async function errorFrom(res: Response): Promise<ProviderError> {
  let shape = { code: '', message: '' }
  try {
    const json = JSON.parse((await res.text()).slice(0, 4096)) as { error?: unknown }
    const e = json.error
    if (typeof e === 'string') shape = { code: '', message: e }
    else if (typeof e === 'object' && e !== null) {
      const r = e as Record<string, unknown>
      shape = {
        code: typeof r.code === 'string' ? r.code : '',
        message: typeof r.message === 'string' ? r.message : '',
      }
    }
  } catch {
    // Unreadable body: classify by status alone.
  }
  const error = classifyHttpError(
    res.status,
    shape,
    false,
    parseRetryAfter(res.headers.get('retry-after')),
  )
  // A 404 here usually means the server has no speech-to-text at all (Ollama, for one).
  if (res.status === 404) return new ProviderError('MODEL_NOT_FOUND', false, { status: 404 })
  if (res.status === 400 && /stream/i.test(shape.message)) {
    return new ProviderError('BAD_REQUEST', false, {
      status: 400,
      publicMessage: 'stream-unsupported',
    })
  }
  return error
}

/**
 * OpenAI-compatible `/audio/transcriptions` (D-008). With `stream`, models
 * such as gpt-4o-mini-transcribe send `transcript.text.delta` events; models
 * that can't stream (whisper-1) are retried once without it.
 */
export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'openai-compatible'

  constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async transcribe(clip: AudioClip, options: TranscribeOptions): Promise<string> {
    try {
      return await this.request(clip, options, options.stream)
    } catch (error) {
      const streamRefused =
        error instanceof ProviderError && error.details.publicMessage === 'stream-unsupported'
      if (!streamRefused || !options.stream) throw error
      return this.request(clip, options, false)
    }
  }

  private async request(
    clip: AudioClip,
    options: TranscribeOptions,
    stream: boolean,
  ): Promise<string> {
    const fields: Record<string, string> = { model: options.model, response_format: 'json' }
    if (options.language !== '') fields.language = options.language
    if (stream) fields.stream = 'true'
    const { body, contentType } = multipartBody(fields, {
      field: 'file',
      filename: `speech.${EXTENSIONS[clip.mimeType]}`,
      contentType: clip.mimeType,
      bytes: clip.bytes,
    })
    const headers: Record<string, string> = { 'Content-Type': contentType }
    if (this.config.apiKey !== null) headers.Authorization = `Bearer ${this.config.apiKey}`

    try {
      let res: Response
      try {
        res = await this.fetchImpl(`${this.config.baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers,
          body,
          signal: options.signal,
        })
      } catch (error) {
        if (options.signal.aborted) throw error
        throw new ProviderError('PROVIDER_UNAVAILABLE', true)
      }
      if (!res.ok) throw await errorFrom(res)

      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream') && res.body !== null) {
        return await this.readStream(res.body, options)
      }
      const text = await res.text()
      if (type.includes('application/json')) {
        const json = JSON.parse(text) as { text?: unknown }
        return typeof json.text === 'string' ? json.text : ''
      }
      return text
    } finally {
      // The response is complete, so the upload is too: drop this copy of the audio.
      body.fill(0)
    }
  }

  private async readStream(
    body: ReadableStream<Uint8Array>,
    options: TranscribeOptions,
  ): Promise<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    let soFar = ''
    let final: string | null = null
    try {
      for (;;) {
        const { done, value } = await reader.read()
        const events = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }))
        for (const data of events) {
          if (data === '[DONE]') continue
          let event: { type?: unknown; delta?: unknown; text?: unknown; error?: unknown }
          try {
            event = JSON.parse(data) as typeof event
          } catch {
            continue
          }
          if (event.error !== undefined) throw new ProviderError('PROVIDER_ERROR', false)
          if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') {
            soFar += event.delta
            options.onPartial(soFar)
          } else if (event.type === 'transcript.text.done' && typeof event.text === 'string') {
            final = event.text
          }
        }
        if (done) return final ?? soFar
      }
    } finally {
      void reader.cancel().catch(() => undefined)
    }
  }
}

/** Free, offline transcripts so voice can be tried and tested without an account. */
export const MOCK_TRANSCRIPTS = [
  'What’s on my screen right now?',
  'How do I fix this?',
  'Can you explain that more simply?',
]

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock'
  private next = 0

  constructor(private readonly wordMs = 45) {}

  async transcribe(_clip: AudioClip, options: TranscribeOptions): Promise<string> {
    const text = MOCK_TRANSCRIPTS[this.next % MOCK_TRANSCRIPTS.length] ?? ''
    this.next += 1
    let soFar = ''
    for (const word of text.match(/\S+\s*/g) ?? []) {
      await sleep(this.wordMs, options.signal)
      soFar += word
      if (options.stream) options.onPartial(soFar)
    }
    return text
  }
}
