import { describe, expect, it, vi } from 'vitest'
import type { AiConfig } from '@shared/schemas/settings'
import { VoiceSettings, type VoiceEvent } from '@shared/schemas/voice'
import { ProviderError } from '../../../src/main/services/ai/types'
import {
  MICROPHONE_SETTINGS_URL,
  PermissionService,
} from '../../../src/main/services/permissions/PermissionService'
import { MicrophoneGate } from '../../../src/main/security/microphoneGate'
import { multipartBody } from '../../../src/main/services/voice/multipart'
import { SpeechToTextService } from '../../../src/main/services/voice/SpeechToTextService'
import { TextToSpeechService } from '../../../src/main/services/voice/TextToSpeechService'
import {
  MOCK_TRANSCRIPTS,
  MockTranscriptionProvider,
  OpenAiTranscriptionProvider,
  type TranscriptionProvider,
} from '../../../src/main/services/voice/transcription'

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const decode = (b: unknown) => Buffer.from(b as Uint8Array).toString('latin1')

describe('MicrophoneGate', () => {
  it('is closed until armed, and closes on disarm or after its limit', () => {
    let now = 0
    const gate = new MicrophoneGate(1000, () => now)
    expect(gate.isArmed()).toBe(false)
    gate.arm()
    expect(gate.isArmed()).toBe(true)
    now = 999
    expect(gate.isArmed()).toBe(true)
    now = 1000
    expect(gate.isArmed()).toBe(false)
    gate.arm()
    gate.disarm()
    expect(gate.isArmed()).toBe(false)
    expect(gate.armCount()).toBe(2)
  })
})

describe('PermissionService (microphone)', () => {
  const service = (
    status: 'granted' | 'denied' | 'not-determined',
    platform: NodeJS.Platform = 'darwin',
  ) => {
    let current = status
    const askForMic = vi.fn(() => {
      current = 'granted'
      return Promise.resolve(true)
    })
    const openExternal = vi.fn(() => Promise.resolve())
    return {
      askForMic,
      openExternal,
      permissions: new PermissionService({
        platform,
        screenStatus: () => 'granted',
        micStatus: () => current,
        askForMic,
        openExternal,
        grantee: 'Electron',
      }),
    }
  }

  it('prompts only while the status is not-determined', async () => {
    const fresh = service('not-determined')
    expect(await fresh.permissions.requestMic()).toBe('granted')
    expect(fresh.askForMic).toHaveBeenCalledOnce()

    const refused = service('denied')
    expect(await refused.permissions.requestMic()).toBe('denied')
    expect(refused.askForMic).not.toHaveBeenCalled()
  })

  it('links to the fixed Microphone settings URL, and only on macOS', async () => {
    const mac = service('denied')
    await mac.permissions.openMicrophoneSettings()
    expect(mac.openExternal).toHaveBeenCalledWith(MICROPHONE_SETTINGS_URL)
    const linux = service('denied', 'linux')
    expect(linux.permissions.micStatus()).toBe('granted')
    await linux.permissions.openMicrophoneSettings()
    expect(linux.openExternal).not.toHaveBeenCalled()
  })
})

describe('multipartBody', () => {
  it('encodes fields and the file with a boundary', () => {
    const { body, contentType } = multipartBody(
      { model: 'whisper-1', language: 'en' },
      {
        field: 'file',
        filename: 'speech.webm',
        contentType: 'audio/webm',
        bytes: new Uint8Array([1, 2, 3]),
      },
    )
    const boundary = contentType.split('boundary=')[1] ?? ''
    const text = Buffer.from(body).toString('latin1')
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----screenbuddy/)
    expect(text).toContain(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`,
    )
    expect(text).toContain(
      'filename="speech.webm"\r\nContent-Type: audio/webm\r\n\r\n\u0001\u0002\u0003\r\n',
    )
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
}

const clip = () => ({
  bytes: new Uint8Array([9, 9, 9]),
  mimeType: 'audio/webm' as const,
  durationMs: 1200,
})
const options = (
  overrides: Partial<Omit<Parameters<TranscriptionProvider['transcribe']>[1], 'onPartial'>> = {},
) => ({
  signal: new AbortController().signal,
  model: 'gpt-4o-mini-transcribe',
  language: '',
  stream: true,
  onPartial: vi.fn<(text: string) => void>(),
  ...overrides,
})

describe('OpenAiTranscriptionProvider', () => {
  it('posts the recording as multipart with the model, streams partials, then wipes its copy', async () => {
    let sent = ''
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>((_url, init) => {
      sent = decode(init.body) // what actually went over the wire
      return Promise.resolve(
        sse([
          { type: 'transcript.text.delta', delta: 'What is ' },
          { type: 'transcript.text.delta', delta: 'this?' },
          { type: 'transcript.text.done', text: 'What is this?' },
        ]),
      )
    })
    const provider = new OpenAiTranscriptionProvider(
      { baseUrl: 'https://api.test/v1', apiKey: 'sk-key-123456' },
      fetch,
    )
    const opts = options({ language: 'en' })
    expect(await provider.transcribe(clip(), opts)).toBe('What is this?')
    expect(opts.onPartial.mock.calls.map(([t]) => t)).toEqual(['What is ', 'What is this?'])
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.test/v1/audio/transcriptions')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-key-123456')
    expect(sent).toContain('name="model"\r\n\r\ngpt-4o-mini-transcribe')
    expect(sent).toContain('name="stream"\r\n\r\ntrue')
    expect(sent).toContain('name="language"\r\n\r\nen')
    // Once the response is complete the request body is zero-filled.
    expect((init?.body as Uint8Array).every((b) => b === 0)).toBe(true)
  })

  it('reads a plain JSON reply', async () => {
    const provider = new OpenAiTranscriptionProvider(
      { baseUrl: 'https://api.test/v1', apiKey: 'k' },
      () => Promise.resolve(Response.json({ text: 'Hello there' })),
    )
    expect(await provider.transcribe(clip(), options({ stream: false }))).toBe('Hello there')
  })

  it('retries without streaming for models that refuse it (whisper-1)', async () => {
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'Streaming is not supported for whisper-1' } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ text: 'ok' }))
    const provider = new OpenAiTranscriptionProvider(
      { baseUrl: 'https://api.test/v1', apiKey: 'k' },
      fetch,
    )
    expect(await provider.transcribe(clip(), options())).toBe('ok')
    // Bodies are wiped after each request, so check the second one's length instead.
    const [first, second] = fetch.mock.calls.map(([, init]) => (init.body as Uint8Array).byteLength)
    expect(second).toBeLessThan(first ?? 0)
  })

  it('maps a missing endpoint (Ollama has none) and network failures', async () => {
    const missing = new OpenAiTranscriptionProvider(
      { baseUrl: 'http://localhost:11434/v1', apiKey: null },
      () => Promise.resolve(new Response('404 page not found', { status: 404 })),
    )
    await expect(missing.transcribe(clip(), options())).rejects.toMatchObject({
      code: 'MODEL_NOT_FOUND',
    })
    const offline = new OpenAiTranscriptionProvider(
      { baseUrl: 'https://api.test/v1', apiKey: 'k' },
      () => Promise.reject(new TypeError('fetch failed')),
    )
    await expect(offline.transcribe(clip(), options())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    })
  })
})

// ---------------------------------------------------------------------------

const aiConfig = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  provider: 'openai-compatible',
  baseUrl: 'https://api.test/v1',
  model: 'm',
  supportsVision: true,
  ...overrides,
})

function stt(
  provider: TranscriptionProvider,
  opts: {
    ai?: Partial<AiConfig>
    apiKey?: string | null
    timeoutMs?: number
    mockSource?: boolean
  } = {},
) {
  const events: VoiceEvent[] = []
  const kinds: string[] = []
  const voice = VoiceSettings.parse({
    transcription: { source: opts.mockSource === true ? 'mock' : 'chat-provider' },
  })
  const service = new SpeechToTextService({
    voice: () => voice,
    credentials: () => ({
      ai: aiConfig(opts.ai),
      apiKey: opts.apiKey === undefined ? 'sk-key-123456' : opts.apiKey,
    }),
    providerFor: (kind) => {
      kinds.push(kind)
      return provider
    },
    emit: (e) => events.push(e),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  })
  return { service, events, kinds }
}

const request = (i = 1) => ({
  requestId: uuid(i),
  mimeType: 'audio/webm' as const,
  bytes: new Uint8Array([5, 6, 7, 8]),
  durationMs: 900,
})

const scripted = (
  ...steps: ((o: Parameters<TranscriptionProvider['transcribe']>[1]) => Promise<string>)[]
) => {
  const calls = vi.fn()
  const provider: TranscriptionProvider = {
    name: 'scripted',
    transcribe: (_clip, o) => {
      calls()
      const step = steps.shift()
      if (step === undefined) throw new Error('no step')
      return step(o)
    },
  }
  return { provider, calls }
}

const hang = (o: { signal: AbortSignal }) =>
  new Promise<string>((_r, reject) =>
    o.signal.addEventListener('abort', () => reject(new Error('aborted'))),
  )

describe('SpeechToTextService', () => {
  it('returns the transcript, forwards partials, and wipes the audio', async () => {
    const { provider } = scripted((o) => {
      o.onPartial('Hello')
      return Promise.resolve('  Hello there  ')
    })
    const h = stt(provider)
    const r = request()
    expect(await h.service.transcribe(r)).toEqual({ status: 'ok', text: 'Hello there' })
    expect(h.events).toEqual([{ type: 'partial', requestId: uuid(1), text: 'Hello' }])
    expect(r.bytes.every((b) => b === 0)).toBe(true)
  })

  it('uses the free mock when the chat provider is mock, or when chosen', async () => {
    const { provider } = scripted(
      () => Promise.resolve('x'),
      () => Promise.resolve('y'),
    )
    const a = stt(provider, { ai: { provider: 'mock' } })
    await a.service.transcribe(request())
    expect(a.kinds).toEqual(['mock'])
    const b = stt(provider, { mockSource: true })
    await b.service.transcribe(request())
    expect(b.kinds).toEqual(['mock'])
  })

  it('needs a key for a remote provider', async () => {
    const { provider, calls } = scripted()
    const r = request()
    expect(await stt(provider, { apiKey: null }).service.transcribe(r)).toMatchObject({
      status: 'failed',
      error: { code: 'NOT_CONFIGURED' },
    })
    expect(calls).not.toHaveBeenCalled()
    expect(r.bytes.every((b) => b === 0)).toBe(true)
  })

  it('network disconnect: retries once, then reports it as retryable', async () => {
    const fail = () => Promise.reject(new ProviderError('PROVIDER_UNAVAILABLE', true))
    const { provider, calls } = scripted(fail, fail)
    expect(await stt(provider).service.transcribe(request())).toMatchObject({
      status: 'failed',
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('does not retry a rejected key, and maps a missing endpoint to UNSUPPORTED', async () => {
    const { provider, calls } = scripted(() =>
      Promise.reject(new ProviderError('INVALID_API_KEY', false)),
    )
    expect(await stt(provider).service.transcribe(request())).toMatchObject({
      error: { code: 'INVALID_API_KEY' },
    })
    expect(calls).toHaveBeenCalledOnce()
    const missing = scripted(() => Promise.reject(new ProviderError('MODEL_NOT_FOUND', false)))
    expect(await stt(missing.provider).service.transcribe(request())).toMatchObject({
      error: { code: 'UNSUPPORTED' },
    })
  })

  it('cancels on request and times out on its own', async () => {
    const a = stt(scripted(hang).provider)
    const pending = a.service.transcribe(request(1))
    a.service.cancel(uuid(1))
    expect(await pending).toMatchObject({ error: { code: 'CANCELED' } })

    const b = stt(scripted(hang).provider, { timeoutMs: 20 })
    expect(await b.service.transcribe(request())).toMatchObject({ error: { code: 'TIMEOUT' } })
  })

  it('refuses a second recording while one is being transcribed', async () => {
    const h = stt(scripted(hang).provider)
    const first = h.service.transcribe(request(1))
    expect(await h.service.transcribe(request(2))).toMatchObject({ error: { code: 'BUSY' } })
    h.service.cancel(uuid(1))
    await first
  })
})

describe('MockTranscriptionProvider', () => {
  it('cycles through canned transcripts, streaming words', async () => {
    const mock = new MockTranscriptionProvider(0)
    const opts = options()
    expect(await mock.transcribe(clip(), opts)).toBe(MOCK_TRANSCRIPTS[0])
    expect(opts.onPartial).toHaveBeenCalled()
    expect(await mock.transcribe(clip(), options())).toBe(MOCK_TRANSCRIPTS[1])
  })
})

describe('TextToSpeechService', () => {
  const tts = (
    fetch: (url: string, init: RequestInit) => Promise<Response>,
    ai: Partial<AiConfig> = {},
  ) =>
    new TextToSpeechService({
      voice: () => VoiceSettings.parse({}),
      credentials: () => ({ ai: aiConfig(ai), apiKey: 'sk-key-123456' }),
      fetch,
    })

  it('asks the provider for speech and returns the audio', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }),
      ),
    )
    const outcome = await tts(fetch).speak('Hello')
    expect(outcome).toMatchObject({ status: 'ok', mimeType: 'audio/mpeg' })
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: 'Hello',
    })
  })

  it('is unavailable in mock mode, offline, or with a non-audio reply', async () => {
    expect(
      await tts(() => Promise.reject(new Error('x')), { provider: 'mock' }).speak('hi'),
    ).toMatchObject({
      error: { code: 'NOT_CONFIGURED' },
    })
    expect(
      await tts(() => Promise.reject(new TypeError('fetch failed'))).speak('hi'),
    ).toMatchObject({
      error: { code: 'PROVIDER_UNAVAILABLE' },
    })
    expect(
      await tts(() =>
        Promise.resolve(new Response('<html>', { headers: { 'content-type': 'text/html' } })),
      ).speak('hi'),
    ).toMatchObject({ error: { code: 'PROVIDER_ERROR' } })
  })
})
