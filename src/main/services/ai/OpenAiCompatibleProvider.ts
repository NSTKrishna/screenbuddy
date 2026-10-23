import { SseParser } from './sse'
import {
  ProviderError,
  type ChatProvider,
  type ProviderMessage,
  type ProviderRequest,
  type StreamOptions,
  type StreamResult,
} from './types'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface OpenAiCompatibleConfig {
  /** Already validated by `checkBaseUrl`, without a trailing slash. */
  baseUrl: string
  /** Null for local servers that need no key. */
  apiKey: string | null
}

/** Only the first few KB of an error body are read, and only to classify it. */
const ERROR_BODY_LIMIT = 4096

const IMAGE_HINT = /image|vision|multimodal|multi-modal|image_url|modalit/i
const CONTEXT_HINT =
  /context.length|context_length|too long|maximum context|max(imum)? tokens|token limit/i
const MODEL_HINT = /model/i
const NOT_FOUND_HINT = /not.found|does not exist|unknown|no such|invalid model|not available/i

function toWireMessage(m: ProviderMessage): unknown {
  if (m.image === undefined) return { role: m.role, content: m.text }
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.text },
      {
        type: 'image_url',
        image_url: { url: `data:${m.image.mimeType};base64,${m.image.base64}`, detail: 'auto' },
      },
    ],
  }
}

/** Seconds or an HTTP date, capped so a hostile header can't stall the app. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  if (!Number.isFinite(ms) || ms < 0) return undefined
  return Math.min(ms, 30_000)
}

interface ErrorShape {
  code: string
  message: string
}

function readErrorShape(value: unknown): ErrorShape {
  const error =
    typeof value === 'object' && value !== null && 'error' in value ? value.error : value
  if (typeof error === 'string') return { code: '', message: error }
  if (typeof error !== 'object' || error === null) return { code: '', message: '' }
  const e = error as Record<string, unknown>
  const code = [e.code, e.type].filter((v) => typeof v === 'string').join(' ')
  return { code, message: typeof e.message === 'string' ? e.message : '' }
}

/** Maps an HTTP failure to a ProviderError. Exported for unit tests. */
export function classifyHttpError(
  status: number,
  shape: ErrorShape,
  hadImage: boolean,
  retryAfterMs?: number,
): ProviderError {
  const text = `${shape.code} ${shape.message}`
  const details = { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
  // Text-only models reject image parts in many different ways; check this first.
  if (hadImage && IMAGE_HINT.test(text) && status >= 400) {
    return new ProviderError('VISION_UNSUPPORTED', false, details)
  }
  if (status === 401 || status === 403) return new ProviderError('INVALID_API_KEY', false, details)
  if (status === 404) return new ProviderError('MODEL_NOT_FOUND', false, details)
  if (status === 408) return new ProviderError('TIMEOUT', true, details)
  if (status === 429) {
    // An exhausted quota won't fix itself on retry.
    const quota = /insufficient_quota|quota|billing/i.test(text)
    return new ProviderError('RATE_LIMITED', !quota, details)
  }
  if (status === 400 || status === 413 || status === 422) {
    if (CONTEXT_HINT.test(text)) return new ProviderError('CONTEXT_TOO_LONG', false, details)
    if (MODEL_HINT.test(text) && NOT_FOUND_HINT.test(text)) {
      return new ProviderError('MODEL_NOT_FOUND', false, details)
    }
    return new ProviderError('BAD_REQUEST', false, details)
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ProviderError('PROVIDER_UNAVAILABLE', true, details)
  }
  if (status >= 500) return new ProviderError('PROVIDER_ERROR', true, details)
  return new ProviderError('PROVIDER_ERROR', false, details)
}

async function readLimited(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, ERROR_BODY_LIMIT)
  } catch {
    return ''
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

interface ChunkShape {
  error?: unknown
  choices?: {
    delta?: { content?: unknown }
    message?: { content?: unknown }
    finish_reason?: unknown
  }[]
}

/**
 * Talks to any OpenAI-compatible `/chat/completions` endpoint: OpenAI,
 * OpenRouter, Ollama, LM Studio, vLLM. Streams with SSE, and also accepts a
 * plain JSON reply from servers that ignore `stream: true`.
 */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly name = 'openai-compatible'

  constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async stream(request: ProviderRequest, options: StreamOptions): Promise<StreamResult> {
    const hadImage = request.messages.some((m) => m.image !== undefined)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    }
    if (this.config.apiKey !== null) headers.Authorization = `Bearer ${this.config.apiKey}`

    const body = JSON.stringify({
      model: request.model,
      messages: request.messages.map(toWireMessage),
      stream: true,
      max_tokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    })

    let res: Response
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal.aborted) throw error
      // DNS failure, refused connection, TLS error: the provider is out of reach.
      throw new ProviderError('PROVIDER_UNAVAILABLE', true)
    }

    if (!res.ok) {
      const shape = readErrorShape(parseJson(await readLimited(res)))
      throw classifyHttpError(
        res.status,
        shape,
        hadImage,
        parseRetryAfter(res.headers.get('retry-after')),
      )
    }

    options.onConnected()
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('application/json')) return this.readWholeReply(res, hadImage, options)
    if (res.body === null) throw new ProviderError('PROVIDER_ERROR', true)
    return this.readStream(res.body, hadImage, options)
  }

  private async readWholeReply(
    res: Response,
    hadImage: boolean,
    options: StreamOptions,
  ): Promise<StreamResult> {
    const json = parseJson(await res.text()) as ChunkShape | null
    if (json?.error !== undefined) throw classifyHttpError(500, readErrorShape(json), hadImage)
    const choice = json?.choices?.[0]
    const content = choice?.message?.content
    if (typeof content === 'string' && content !== '') options.onDelta(content)
    return { truncated: choice?.finish_reason === 'length' }
  }

  private async readStream(
    body: ReadableStream<Uint8Array>,
    hadImage: boolean,
    options: StreamOptions,
  ): Promise<StreamResult> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    let truncated = false

    const handle = (data: string): boolean => {
      if (data === '[DONE]') return true
      const chunk = parseJson(data) as ChunkShape | null
      if (chunk === null) return false
      // Some providers report failures inside the stream rather than with a status.
      if (chunk.error !== undefined) {
        throw classifyHttpError(500, readErrorShape(chunk), hadImage)
      }
      const choice = chunk.choices?.[0]
      const text = choice?.delta?.content
      if (typeof text === 'string' && text !== '') options.onDelta(text)
      if (choice?.finish_reason === 'length') truncated = true
      return false
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        const events = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }))
        for (const data of events) if (handle(data)) return { truncated }
        if (done) return { truncated }
      }
    } finally {
      // Stop the download on early return or on abort.
      void reader.cancel().catch(() => undefined)
    }
  }
}
