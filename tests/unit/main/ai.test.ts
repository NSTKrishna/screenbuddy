import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkBaseUrl } from '@shared/baseUrl'
import type { ChatEvent } from '@shared/schemas/chat'
import type { AiConfig } from '@shared/schemas/settings'
import { AiService, MAX_ATTEMPTS, type AiTimeouts } from '../../../src/main/services/ai/AiService'
import { buildContext, type Turn } from '../../../src/main/services/ai/context'
import { MockProvider, pickMockReply } from '../../../src/main/services/ai/MockProvider'
import {
  classifyHttpError,
  OpenAiCompatibleProvider,
  parseRetryAfter,
} from '../../../src/main/services/ai/OpenAiCompatibleProvider'
import { SYSTEM_PROMPT } from '../../../src/main/services/ai/prompts'
import { SseParser } from '../../../src/main/services/ai/sse'
import {
  ProviderError,
  type ChatProvider,
  type ProviderRequest,
  type StreamOptions,
  type StreamResult,
} from '../../../src/main/services/ai/types'
import { CaptureStore } from '../../../src/main/services/capture/CaptureStore'
import { ConversationStore } from '../../../src/main/services/storage/ConversationStore'

// ---------------------------------------------------------------------------
// SSE

describe('SseParser', () => {
  it('returns complete events and buffers partial ones across chunks', () => {
    const p = new SseParser()
    expect(p.push('data: {"a"')).toEqual([])
    expect(p.push(':1}\n')).toEqual([])
    expect(p.push('\ndata: [DO')).toEqual(['{"a":1}'])
    expect(p.push('NE]\n\n')).toEqual(['[DONE]'])
  })

  it('handles CRLF (even split across chunks), comments and multi-line data', () => {
    const p = new SseParser()
    expect(p.push(': keep-alive\r\ndata: one\r')).toEqual([])
    expect(p.push('\ndata: two\r\n\r\n')).toEqual(['one\ntwo'])
    expect(p.push('event: x\nid: 1\ndata:three\n\n')).toEqual(['three'])
  })

  it('flushes a final event with no trailing blank line', () => {
    const p = new SseParser()
    p.push('data: last')
    expect(p.flush()).toEqual(['last'])
  })
})

// ---------------------------------------------------------------------------
// OpenAI-compatible provider

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  })
}

const delta = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

function streamOpts(overrides: Partial<StreamOptions> = {}) {
  const words: string[] = []
  return {
    words,
    options: {
      signal: new AbortController().signal,
      onConnected: vi.fn(),
      onDelta: (t: string) => words.push(t),
      ...overrides,
    } satisfies StreamOptions,
  }
}

const imageRequest: ProviderRequest = {
  model: 'gpt-4o-mini',
  maxTokens: 100,
  messages: [
    { role: 'system', text: 'sys' },
    {
      role: 'user',
      text: 'what is this?',
      image: { mimeType: 'image/jpeg', base64: 'QUJD', width: 10, height: 10 },
    },
  ],
}

describe('OpenAiCompatibleProvider', () => {
  it('posts an OpenAI chat request with the image as a content part', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(sseResponse([delta('Hi'), 'data: [DONE]\n\n'])),
    )
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret-key-123' },
      fetch,
    )
    await provider.stream(imageRequest, streamOpts().options)
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-key-123')
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'gpt-4o-mini', stream: true, max_tokens: 100 })
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD', detail: 'auto' } },
        ],
      },
    ])
  })

  it('sends no Authorization header without a key (local servers)', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(sseResponse(['data: [DONE]\n\n'])),
    )
    await new OpenAiCompatibleProvider(
      { baseUrl: 'http://localhost:11434/v1', apiKey: null },
      fetch,
    ).stream(imageRequest, streamOpts().options)
    expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty('Authorization')
  })

  it('streams words split across network chunks and notes truncation', async () => {
    const full =
      delta('Line one. ') +
      delta('Line two.') +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n` +
      'data: [DONE]\n\n'
    const chunks = full.match(/.{1,7}/gs) ?? []
    const { words, options } = streamOpts()
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://x.test/v1', apiKey: 'k' },
      () => Promise.resolve(sseResponse(chunks)),
    )
    expect(await provider.stream(imageRequest, options)).toEqual({ truncated: true })
    expect(words.join('')).toBe('Line one. Line two.')
    expect(options.onConnected).toHaveBeenCalledOnce()
  })

  it('accepts a plain JSON reply from servers that ignore stream: true', async () => {
    const { words, options } = streamOpts()
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://x.test/v1', apiKey: 'k' },
      () =>
        Promise.resolve(
          Response.json({
            choices: [{ message: { content: 'Whole answer' }, finish_reason: 'stop' }],
          }),
        ),
    )
    await provider.stream(imageRequest, options)
    expect(words).toEqual(['Whole answer'])
  })

  it('turns an error inside the stream into a ProviderError', async () => {
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://x.test/v1', apiKey: 'k' },
      () =>
        Promise.resolve(
          sseResponse([`data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`]),
        ),
    )
    await expect(provider.stream(imageRequest, streamOpts().options)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })

  it('maps a refused connection to PROVIDER_UNAVAILABLE', async () => {
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://x.test/v1', apiKey: 'k' },
      () => Promise.reject(new TypeError('fetch failed')),
    )
    await expect(provider.stream(imageRequest, streamOpts().options)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    })
  })

  it('rethrows an abort unchanged so AiService can tell cancel from failure', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://x.test/v1', apiKey: 'k' },
      () => Promise.reject(new DOMException('aborted', 'AbortError')),
    )
    await expect(
      provider.stream(imageRequest, streamOpts({ signal: controller.signal }).options),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('never puts the provider’s error text in the error it throws', async () => {
    const provider = new OpenAiCompatibleProvider(
      { baseUrl: 'https://x.test/v1', apiKey: 'k' },
      () =>
        Promise.resolve(
          Response.json(
            { error: { message: 'Incorrect API key provided: sk-abc…xyz' } },
            { status: 401 },
          ),
        ),
    )
    const error = await provider.stream(imageRequest, streamOpts().options).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as Error).message).not.toContain('sk-')
  })
})

describe('classifyHttpError', () => {
  const shape = (message: string, code = '') => ({ message, code })
  it.each([
    [401, shape('bad key'), false, 'INVALID_API_KEY', false],
    [403, shape('forbidden'), false, 'INVALID_API_KEY', false],
    [404, shape('not found'), false, 'MODEL_NOT_FOUND', false],
    [429, shape('slow down'), false, 'RATE_LIMITED', true],
    [
      429,
      shape('You exceeded your current quota', 'insufficient_quota'),
      false,
      'RATE_LIMITED',
      false,
    ],
    [
      400,
      shape('Invalid content type. image_url is only supported by certain models.'),
      true,
      'VISION_UNSUPPORTED',
      false,
    ],
    [500, shape('model does not support images'), true, 'VISION_UNSUPPORTED', false],
    [
      400,
      shape("This model's maximum context length is 8192 tokens"),
      false,
      'CONTEXT_TOO_LONG',
      false,
    ],
    [400, shape('The model `gpt-9` does not exist'), false, 'MODEL_NOT_FOUND', false],
    [400, shape('bad'), false, 'BAD_REQUEST', false],
    [500, shape('oops'), false, 'PROVIDER_ERROR', true],
    [503, shape('busy'), false, 'PROVIDER_UNAVAILABLE', true],
  ] as const)('HTTP %i %j (image: %s) → %s', (status, s, hadImage, code, retryable) => {
    expect(classifyHttpError(status, s, hadImage)).toMatchObject({ code, retryable })
  })

  it('only blames vision when an image was actually sent', () => {
    expect(classifyHttpError(400, shape('image_url not supported'), false).code).toBe('BAD_REQUEST')
  })

  it('parses Retry-After as seconds or a date, capped at 30 s', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('9999')).toBe(30_000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 5_000)).toBe(5000)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
  })
})

describe('checkBaseUrl', () => {
  it.each([
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1'],
  ])('accepts %s', (input, url) => {
    expect(checkBaseUrl(input)).toEqual({ ok: true, url })
  })

  it.each([
    'http://api.openai.com/v1',
    'ftp://x.test',
    'https://user:pass@api.test/v1',
    'https://api.test/v1?key=sk-123',
    'not a url',
    '',
  ])('rejects %j', (input) => {
    expect(checkBaseUrl(input).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Context

describe('buildContext', () => {
  const turn = (user: string, assistant: string | null, extra: Partial<Turn> = {}): Turn => ({
    user: { text: user, hadImage: false },
    assistant: assistant === null ? null : { text: assistant, stopped: false },
    failed: false,
    ...extra,
  })

  it('starts with the system prompt and ends with the current question and image', () => {
    const image = { mimeType: 'image/jpeg' as const, base64: 'QQ==', width: 1, height: 1 }
    const messages = buildContext([], { text: 'Why this error?', image })
    expect(messages[0]).toEqual({ role: 'system', text: SYSTEM_PROMPT })
    expect(messages.at(-1)).toEqual({ role: 'user', text: 'Why this error?', image })
  })

  it('includes earlier turns as text only, noting screenshots that are gone', () => {
    const messages = buildContext(
      [
        turn('What is on screen?', 'VS Code with an error.', {
          user: { text: 'What is on screen?', hadImage: true },
        }),
      ],
      { text: 'How do I fix it?' },
    )
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messages[1]?.text).toContain('no longer available')
    expect(messages.slice(0, -1).some((m) => m.image !== undefined)).toBe(false)
  })

  it('leaves out failed turns', () => {
    const messages = buildContext([turn('broken', null, { failed: true })], { text: 'next' })
    expect(messages.map((m) => m.text)).not.toContain('broken')
  })

  it('keeps only the newest turns that fit, starting on a user message', () => {
    const history = Array.from({ length: 30 }, (_, i) => turn(`q${i}`, `a${i}`))
    const messages = buildContext(
      history,
      { text: 'now' },
      {
        maxHistoryMessages: 5,
        maxHistoryChars: 10_000,
        maxMessageChars: 100,
      },
    )
    const earlier = messages.slice(1, -1)
    expect(earlier.length).toBeLessThanOrEqual(5)
    expect(earlier[0]?.role).toBe('user')
    expect(earlier.at(-1)?.text).toBe('a29')
    expect(messages[0]?.text).toContain('left out')
  })

  it('shortens very long earlier messages', () => {
    const messages = buildContext(
      [turn('x'.repeat(10_000), 'ok')],
      { text: 'next' },
      {
        maxHistoryMessages: 10,
        maxHistoryChars: 50_000,
        maxMessageChars: 500,
      },
    )
    expect(messages[1]?.text.length).toBeLessThan(600)
  })

  it('gives an image-only question a sensible prompt', () => {
    const image = { mimeType: 'image/jpeg' as const, base64: 'QQ==', width: 1, height: 1 }
    expect(buildContext([], { text: '  ', image }).at(-1)?.text).toMatch(/look at this screenshot/i)
  })
})

// ---------------------------------------------------------------------------
// Mock provider

describe('MockProvider', () => {
  it('streams a reply through the same interface, aware of images and follow-ups', async () => {
    const mock = new MockProvider({ thinkMs: [0, 0], wordMs: [0, 0] })
    const { words, options } = streamOpts()
    await mock.stream(
      {
        model: 'm',
        maxTokens: 10,
        messages: [
          { role: 'user', text: 'first' },
          { role: 'assistant', text: 'ok' },
          {
            role: 'user',
            text: 'second',
            image: { mimeType: 'image/jpeg', base64: '', width: 8, height: 6 },
          },
        ],
      },
      options,
    )
    const reply = words.join('')
    expect(reply).toContain('I received a screenshot (8×6)')
    expect(reply).toContain('message 2')
  })

  it('fails on purpose for /fail', async () => {
    const mock = new MockProvider({ thinkMs: [0, 0], wordMs: [0, 0] })
    await expect(
      mock.stream(
        { model: 'm', maxTokens: 1, messages: [{ role: 'user', text: '/fail' }] },
        streamOpts().options,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('has tailored replies', () => {
    expect(pickMockReply('hello', undefined, 1)).toMatch(/mock mode/)
  })
})

// ---------------------------------------------------------------------------
// AiService

type Step = (options: StreamOptions, request: ProviderRequest) => Promise<StreamResult>

/** Waits until the signal aborts, then rejects like fetch does. */
const hang: Step = ({ signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

const answer =
  (...words: string[]): Step =>
  (o) => {
    o.onConnected()
    for (const w of words) o.onDelta(w)
    return Promise.resolve({ truncated: false })
  }

const failWith =
  (code: ConstructorParameters<typeof ProviderError>[0], retryable: boolean): Step =>
  () =>
    Promise.reject(new ProviderError(code, retryable))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'screenbuddy-ai-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

function harness(
  options: {
    steps?: Step[]
    config?: Partial<AiConfig>
    apiKey?: string | null
    saveHistory?: boolean
    timeouts?: AiTimeouts
  } = {},
) {
  const steps = [...(options.steps ?? [])]
  const requests: ProviderRequest[] = []
  const provider: ChatProvider = {
    name: 'scripted',
    stream: (request, o) => {
      requests.push(request)
      const step = steps.shift()
      if (step === undefined) throw new Error('no scripted step left')
      return step(o, request)
    },
  }
  const config: AiConfig = {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'vision-model',
    supportsVision: true,
    ...options.config,
  }
  const events: ChatEvent[] = []
  const captures = new CaptureStore()
  const store = new ConversationStore(join(dir, 'conversation.json'))
  let saveHistory = options.saveHistory ?? false
  const service = new AiService({
    config: () => config,
    apiKey: () => (options.apiKey === undefined ? 'sk-test-key-123' : options.apiKey),
    captures,
    providerFor: () => provider,
    emit: (e) => events.push(e),
    history: { enabled: () => saveHistory, store },
    timeouts: options.timeouts ?? { firstTokenMs: 5_000, idleMs: 5_000, totalMs: 10_000 },
    backoffBaseMs: 1,
    random: () => 0.5,
  })
  const addCapture = (id: string) => {
    captures.put({
      id,
      jpeg: Buffer.from('fake-jpeg-bytes'),
      width: 1568,
      height: 1018,
      displayId: 1,
      createdAt: 0,
    })
  }
  const settle = () =>
    vi.waitFor(() => {
      const last = events.at(-1)
      if (last?.type !== 'done' && last?.type !== 'error') throw new Error('still running')
    })
  return {
    service,
    events,
    requests,
    captures,
    addCapture,
    settle,
    steps,
    config,
    setSaveHistory: (v: boolean) => {
      saveHistory = v
    },
  }
}

const types = (events: ChatEvent[]) =>
  events.map((e) => (e.type === 'progress' ? `progress:${e.stage}` : e.type))

describe('AiService: text-only question', () => {
  it('streams the answer and records the exchange', async () => {
    const h = harness({ steps: [answer('Hello ', 'there.')] })
    expect(h.service.send({ turnId: uuid(1), text: 'Hi', captureId: null })).toEqual({
      accepted: true,
    })
    await h.settle()
    expect(types(h.events)).toEqual([
      'progress:connecting',
      'progress:waiting',
      'started',
      'delta',
      'delta',
      'done',
    ])
    expect(h.requests[0]?.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(h.requests[0]?.messages.some((m) => m.image !== undefined)).toBe(false)
    expect(h.service.history().messages).toEqual([
      { role: 'user', text: 'Hi', hadImage: false },
      { role: 'assistant', text: 'Hello there.', hadImage: false },
    ])
  })
})

describe('AiService: screenshot question', () => {
  it('sends the stored image with the question and frees it afterwards', async () => {
    const h = harness({ steps: [answer('A TypeScript error.')] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'Why am I getting this error?', captureId: uuid(9) })
    await h.settle()
    const last = h.requests[0]?.messages.at(-1)
    expect(last?.image).toMatchObject({
      mimeType: 'image/jpeg',
      base64: Buffer.from('fake-jpeg-bytes').toString('base64'),
      width: 1568,
    })
    expect(h.captures.size).toBe(0)
  })

  it('refuses an image for a model marked text-only, without calling it', async () => {
    const h = harness({ config: { supportsVision: false }, steps: [answer('Text only answer.')] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'What is this?', captureId: uuid(9) })
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({ type: 'error', error: { code: 'VISION_UNSUPPORTED' } })
    expect(h.requests).toHaveLength(0)
    expect(h.captures.size).toBe(1)

    // "Send without screenshot"
    expect(h.service.retry({ turnId: uuid(2), withoutImage: true }).accepted).toBe(true)
    await vi.waitFor(() => expect(h.events.at(-1)?.type).toBe('done'))
    expect(h.requests[0]?.messages.at(-1)?.image).toBeUndefined()
    expect(h.captures.size).toBe(0)
  })

  it('recovers when the provider says the model can’t read images', async () => {
    const h = harness({ steps: [failWith('VISION_UNSUPPORTED', false), answer('ok')] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'What is this?', captureId: uuid(9) })
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({
      error: { code: 'VISION_UNSUPPORTED', retryable: false },
    })
    expect(h.requests).toHaveLength(1)
    h.service.retry({ turnId: uuid(2), withoutImage: true })
    await vi.waitFor(() => expect(h.events.at(-1)?.type).toBe('done'))
    expect(h.requests[1]?.messages.at(-1)?.image).toBeUndefined()
  })

  it('reports a screenshot that has expired', async () => {
    const h = harness()
    h.service.send({ turnId: uuid(1), text: 'What is this?', captureId: uuid(9) })
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({ error: { code: 'IMAGE_EXPIRED' } })
  })
})

describe('AiService: follow-up conversation', () => {
  it('sends the earlier exchange as context, without the earlier image', async () => {
    const h = harness({ steps: [answer('It is a type error.'), answer('Change the type.')] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'Why this error?', captureId: uuid(9) })
    await h.settle()
    h.events.length = 0
    h.service.send({ turnId: uuid(2), text: 'How do I fix it?', captureId: null })
    await h.settle()
    const messages = h.requests[1]?.messages ?? []
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messages[1]?.text).toContain('Why this error?')
    expect(messages[2]?.text).toBe('It is a type error.')
    expect(messages.some((m) => m.image !== undefined)).toBe(false)
  })

  it('refuses a second question while one is running', () => {
    const h = harness({ steps: [hang] })
    h.service.send({ turnId: uuid(1), text: 'one', captureId: null })
    expect(h.service.send({ turnId: uuid(2), text: 'two', captureId: null })).toMatchObject({
      accepted: false,
      error: { code: 'BUSY' },
    })
  })
})

describe('AiService: provider unavailable', () => {
  it('retries transient failures with backoff, then reports them', async () => {
    const steps = Array.from({ length: MAX_ATTEMPTS }, () => failWith('PROVIDER_UNAVAILABLE', true))
    const h = harness({ steps })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(h.requests).toHaveLength(MAX_ATTEMPTS)
    expect(types(h.events)).toEqual([
      'progress:connecting',
      'progress:retrying',
      'progress:retrying',
      'error',
    ])
    expect(h.events.at(-1)).toMatchObject({
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    })
  })

  it('succeeds if a retry gets through', async () => {
    const h = harness({ steps: [failWith('PROVIDER_UNAVAILABLE', true), answer('ok')] })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(h.events.at(-1)?.type).toBe('done')
  })

  it('never retries once words have streamed, so nothing repeats', async () => {
    const h = harness({
      steps: [
        (o) => {
          o.onDelta('partial ')
          return Promise.reject(new ProviderError('PROVIDER_UNAVAILABLE', true))
        },
      ],
    })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(h.requests).toHaveLength(1)
    expect(h.events.at(-1)?.type).toBe('error')
  })

  it('keeps a failed question for Retry, image included', async () => {
    const h = harness({ steps: [failWith('PROVIDER_ERROR', false), answer('ok')] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'what?', captureId: uuid(9) })
    await h.settle()
    expect(h.captures.size).toBe(1)
    expect(h.service.history().messages).toEqual([])
    h.service.retry({ turnId: uuid(2), withoutImage: false })
    await vi.waitFor(() => expect(h.events.at(-1)?.type).toBe('done'))
    expect(h.requests[1]?.messages.at(-1)?.image).toBeDefined()
    expect(h.captures.size).toBe(0)
  })

  it('drops the failed question’s image if the user asks something else instead', async () => {
    const h = harness({ steps: [failWith('PROVIDER_ERROR', false), answer('ok')] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'what?', captureId: uuid(9) })
    await h.settle()
    h.service.send({ turnId: uuid(2), text: 'never mind', captureId: null })
    expect(h.captures.size).toBe(0)
    await vi.waitFor(() => expect(h.events.at(-1)?.type).toBe('done'))
    expect(h.requests[1]?.messages.map((m) => m.text)).not.toContain('what?')
  })

  it('has nothing to retry when nothing failed', () => {
    expect(harness().service.retry({ turnId: uuid(1), withoutImage: false })).toMatchObject({
      accepted: false,
      error: { code: 'NOTHING_TO_RETRY' },
    })
  })
})

describe('AiService: invalid API key and configuration', () => {
  it('reports a rejected key without retrying', async () => {
    const h = harness({ steps: [failWith('INVALID_API_KEY', false)] })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(h.requests).toHaveLength(1)
    expect(h.events.at(-1)).toMatchObject({
      error: { code: 'INVALID_API_KEY', message: expect.stringContaining('API key') as string },
    })
  })

  it('needs a key for a remote provider, but not for a local one', async () => {
    const remote = harness({ apiKey: null })
    remote.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await remote.settle()
    expect(remote.events.at(-1)).toMatchObject({ error: { code: 'NOT_CONFIGURED' } })
    expect(remote.requests).toHaveLength(0)

    const local = harness({
      apiKey: null,
      config: { baseUrl: 'http://localhost:11434/v1' },
      steps: [answer('hi')],
    })
    local.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await local.settle()
    expect(local.events.at(-1)?.type).toBe('done')
  })

  it('Test connection reports success, failures and mock mode', async () => {
    expect(await harness({ steps: [answer('OK')] }).service.testConnection()).toMatchObject({
      ok: true,
    })
    expect(
      await harness({ steps: [failWith('INVALID_API_KEY', false)] }).service.testConnection(),
    ).toMatchObject({
      ok: false,
      code: 'INVALID_API_KEY',
    })
    expect(await harness({ config: { provider: 'mock' } }).service.testConnection()).toMatchObject({
      ok: true,
      message: expect.stringContaining('Mock') as string,
    })
  })
})

describe('AiService: cancellation and timeouts', () => {
  it('stops on request, keeping the partial answer and freeing the image', async () => {
    const h = harness({
      steps: [
        (o) => {
          o.onDelta('Partial ')
          return hang(o, imageRequest)
        },
      ],
    })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'explain', captureId: uuid(9) })
    await vi.waitFor(() => expect(h.events.some((e) => e.type === 'delta')).toBe(true))
    h.service.cancel(uuid(1))
    await h.settle()
    expect(h.events.at(-1)).toEqual({
      type: 'done',
      turnId: uuid(1),
      stopped: true,
      truncated: false,
    })
    expect(h.captures.size).toBe(0)
    expect(h.service.history().messages.at(-1)).toEqual({
      role: 'assistant',
      text: 'Partial ',
      hadImage: false,
    })
  })

  it('cancel for another turn does nothing', async () => {
    const h = harness({ steps: [answer('ok')] })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    h.service.cancel(uuid(2))
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({ type: 'done', stopped: false })
  })

  it('times out when the first word takes too long', async () => {
    const h = harness({
      steps: [hang],
      timeouts: { firstTokenMs: 20, idleMs: 1000, totalMs: 5000 },
    })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({ error: { code: 'TIMEOUT' } })
  })

  it('times out when the stream stalls', async () => {
    const h = harness({
      steps: [
        (o) => {
          o.onDelta('one ')
          return hang(o, imageRequest)
        },
      ],
      timeouts: { firstTokenMs: 1000, idleMs: 20, totalMs: 5000 },
    })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({ error: { code: 'TIMEOUT' } })
  })

  it('cancel during the retry backoff stops at once', async () => {
    const h = harness({ steps: [failWith('PROVIDER_UNAVAILABLE', true), answer('never')] })
    h.service.setTimingForTests({ firstTokenMs: 1000, idleMs: 1000, totalMs: 5000 }, 10_000)
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    h.service.cancel(uuid(1))
    await h.settle()
    expect(h.events.at(-1)).toMatchObject({ type: 'done', stopped: true })
    expect(h.requests).toHaveLength(1)
  })

  it('new chat silences the running turn and frees its image', async () => {
    const h = harness({ steps: [hang] })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: uuid(9) })
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    const before = h.events.length
    h.service.reset()
    await new Promise((r) => setTimeout(r, 10))
    expect(h.events.length).toBe(before)
    expect(h.captures.size).toBe(0)
    expect(h.service.history().messages).toEqual([])
  })
})

describe('AiService: history opt-in', () => {
  const file = () => join(dir, 'conversation.json')

  it('writes nothing to disk unless the user opted in', async () => {
    const h = harness({ steps: [answer('ok')] })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    expect(existsSync(file())).toBe(false)
  })

  it('saves text only, never image data, and restores it on the next launch', async () => {
    const h = harness({ steps: [answer('It is VS Code.')], saveHistory: true })
    h.addCapture(uuid(9))
    h.service.send({ turnId: uuid(1), text: 'What app is this?', captureId: uuid(9) })
    await h.settle()
    await vi.waitFor(() => expect(existsSync(file())).toBe(true))
    const saved = readFileSync(file(), 'utf8')
    expect(saved).toContain('What app is this?')
    expect(saved).toContain('"hadImage": true')
    expect(saved).not.toContain(Buffer.from('fake-jpeg-bytes').toString('base64'))

    const next = harness({ saveHistory: true })
    expect(next.service.history().messages).toHaveLength(2)
  })

  it('turning it off deletes the saved copy', async () => {
    const h = harness({ steps: [answer('ok')], saveHistory: true })
    h.service.send({ turnId: uuid(1), text: 'hi', captureId: null })
    await h.settle()
    await vi.waitFor(() => expect(existsSync(file())).toBe(true))
    h.setSaveHistory(false)
    h.service.historyChanged(false)
    await vi.waitFor(() => expect(existsSync(file())).toBe(false))
  })
})
