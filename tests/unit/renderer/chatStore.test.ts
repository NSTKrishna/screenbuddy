import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureOutcome, CaptureResult } from '@shared/schemas/capture'
import type { ChatAccepted, ChatEvent } from '@shared/schemas/chat'
import type { PublicSettings } from '@shared/schemas/settings'
import { useCaptureStore } from '../../../src/renderer/assistant/stores/useCaptureStore'
import { VoiceSettings } from '@shared/schemas/voice'
import { useChatStore } from '../../../src/renderer/assistant/stores/useChatStore'
import { useSettingsStore } from '../../../src/renderer/assistant/stores/useSettingsStore'

let n = 0
function capture(): CaptureResult {
  n += 1
  return {
    captureId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    source: 'screen',
    label: 'Built-in Retina Display',
    displayId: 1,
    width: 1568,
    height: 1018,
    scaleFactor: 2,
    byteSize: 1000,
    capturedAt: 0,
    preview: { dataUrl: 'data:image/jpeg;base64,AAAA', width: 640, height: 416 },
  }
}

function settings(autoCaptureScreenQuestions = true): PublicSettings {
  return {
    shortcut: 'x',
    showDockIcon: false,
    autoCaptureScreenQuestions,
    saveHistory: false,
    annotationSeconds: 8,
    voice: VoiceSettings.parse({}),
    ai: {
      provider: 'mock',
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
      supportsVision: true,
    },
    apiKey: { present: false, hint: null, storage: 'none' },
  }
}

const api = {
  send: vi.fn<
    (r: { turnId: string; text: string; captureId: string | null }) => Promise<ChatAccepted>
  >(),
  retry: vi.fn<(r: { turnId: string; withoutImage: boolean }) => Promise<ChatAccepted>>(),
  cancel: vi.fn<(turnId: string) => Promise<void>>(() => Promise.resolve()),
  reset: vi.fn(() => Promise.resolve()),
  history: vi.fn(() =>
    Promise.resolve({
      messages: [] as { role: 'user' | 'assistant'; text: string; hadImage: boolean }[],
    }),
  ),
  take: vi.fn<(r: unknown) => Promise<CaptureOutcome>>(),
  discard: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
  importImage: vi.fn<(r: unknown) => Promise<CaptureOutcome>>(),
  getScreen: vi.fn(() =>
    Promise.resolve({ status: 'denied' as const, grantee: 'Electron', canOpenSettings: true }),
  ),
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const chat = useChatStore.getState
const captures = useCaptureStore.getState
const event = (e: ChatEvent) => chat().handleEvent(e)
const lastTurn = (): string => {
  const call = api.send.mock.calls.at(-1)?.[0] ?? api.retry.mock.calls.at(-1)?.[0]
  if (call === undefined) throw new Error('nothing sent')
  return call.turnId
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  api.send.mockResolvedValue({ accepted: true })
  api.retry.mockResolvedValue({ accepted: true })
  // Only the parts of window.screenBuddy these stores touch.
  Object.defineProperty(window, 'screenBuddy', {
    configurable: true,
    value: {
      chat: {
        send: api.send,
        retry: api.retry,
        cancel: api.cancel,
        reset: api.reset,
        history: api.history,
      },
      capture: {
        take: api.take,
        discard: api.discard,
        cancel: () => Promise.resolve(),
        importImage: api.importImage,
        listDisplays: () => Promise.resolve([]),
      },
      permissions: { getScreen: api.getScreen, openScreenSettings: () => Promise.resolve() },
    },
  })
  useSettingsStore.setState({ settings: settings() })
  useCaptureStore.setState({ attachment: null, failure: null, status: 'idle' })
  chat().newChat()
  vi.clearAllMocks()
})

describe('streaming a reply', () => {
  it('sends the question to main and mirrors progress, words and completion', () => {
    chat().send('  What is this error?  ')
    expect(api.send).toHaveBeenCalledWith({
      turnId: expect.any(String) as string,
      text: 'What is this error?',
      captureId: null,
    })
    const turnId = lastTurn()
    expect(chat()).toMatchObject({ status: 'thinking', activeTurnId: turnId })

    event({ type: 'progress', turnId, stage: 'waiting', attempt: 1, maxAttempts: 3 })
    expect(chat().progress?.stage).toBe('waiting')

    event({ type: 'started', turnId })
    expect(chat().status).toBe('responding')
    event({ type: 'delta', turnId, text: 'It means ' })
    event({ type: 'delta', turnId, text: 'a type mismatch.' })
    expect(chat().messages[1]).toMatchObject({
      role: 'assistant',
      text: 'It means a type mismatch.',
      state: 'streaming',
    })

    event({ type: 'done', turnId, stopped: false, truncated: false })
    expect(chat()).toMatchObject({ status: 'idle', activeTurnId: null })
    expect(chat().messages[1]?.state).toBe('done')
  })

  it('ignores events for any other turn', () => {
    chat().send('hello')
    event({ type: 'started', turnId: '00000000-0000-4000-8000-0000000000ff' })
    expect(chat().messages).toHaveLength(1)
  })

  it('stop asks main to cancel the active turn', () => {
    chat().send('hello')
    chat().stop()
    expect(api.cancel).toHaveBeenCalledWith(lastTurn())
  })

  it('shows "stopped" even when stopped before the first word', () => {
    chat().send('hello')
    const turnId = lastTurn()
    event({ type: 'done', turnId, stopped: true, truncated: false })
    expect(chat().messages[1]).toMatchObject({ role: 'assistant', text: '', state: 'stopped' })
  })

  it('marks a truncated answer', () => {
    chat().send('hello')
    const turnId = lastTurn()
    event({ type: 'started', turnId })
    event({ type: 'done', turnId, stopped: false, truncated: true })
    expect(chat().messages[1]?.truncated).toBe(true)
  })

  it('ignores empty prompts and sends while busy', () => {
    chat().send('   ')
    expect(api.send).not.toHaveBeenCalled()
    chat().send('one')
    chat().send('two')
    expect(api.send).toHaveBeenCalledOnce()
  })

  it('reports a request main refused', async () => {
    api.send.mockResolvedValueOnce({
      accepted: false,
      error: { code: 'BUSY', message: 'Wait', retryable: false },
    })
    chat().send('hello')
    await flush()
    expect(chat()).toMatchObject({ status: 'error', error: { code: 'BUSY' } })
  })
})

describe('errors and retry', () => {
  it('drops a half-streamed answer and keeps the error for retry', () => {
    chat().send('hello')
    const turnId = lastTurn()
    event({ type: 'started', turnId })
    event({ type: 'delta', turnId, text: 'half' })
    event({
      type: 'error',
      turnId,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'down', retryable: true },
    })
    expect(chat().messages.map((m) => m.role)).toEqual(['user'])
    expect(chat().error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', hadImage: false })

    chat().retry()
    expect(api.retry).toHaveBeenCalledWith({
      turnId: expect.any(String) as string,
      withoutImage: false,
    })
    expect(chat()).toMatchObject({ status: 'thinking', error: null })
  })

  it('retry without the screenshot drops the chip and tells main', () => {
    useCaptureStore.setState({ attachment: capture() })
    chat().send('what is this?')
    const turnId = lastTurn()
    event({
      type: 'error',
      turnId,
      error: { code: 'VISION_UNSUPPORTED', message: 'no images', retryable: false },
    })
    expect(chat().error?.hadImage).toBe(true)
    chat().retry(true)
    expect(api.retry).toHaveBeenCalledWith({
      turnId: expect.any(String) as string,
      withoutImage: true,
    })
    expect(chat().messages[0]?.attachment).toBeUndefined()
  })
})

describe('attachments', () => {
  it('hands the capture id to main and keeps only a description', () => {
    const c = capture()
    useCaptureStore.setState({ attachment: c })
    chat().send('what is this?')
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ captureId: c.captureId }))
    expect(captures().attachment).toBeNull()
    expect(chat().messages[0]?.attachment).toEqual({
      source: 'screen',
      label: 'Built-in Retina Display',
      width: 1568,
      height: 1018,
    })
    expect(JSON.stringify(chat().messages)).not.toContain('base64')
    // Main frees the image after the request; the renderer doesn't.
    expect(api.discard).not.toHaveBeenCalled()
  })

  it('an attachment can be sent with no text', () => {
    useCaptureStore.setState({ attachment: capture() })
    chat().send('')
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ text: '' }))
  })
})

describe('auto-capture for screen questions', () => {
  it('captures for review and waits for a second Send', async () => {
    api.take.mockResolvedValueOnce({ status: 'captured', capture: capture() })
    chat().setDraft("what's on my screen?")
    chat().send("what's on my screen?")
    await flush()
    expect(api.take).toHaveBeenCalledWith({ target: { kind: 'active' }, reason: 'question' })
    expect(api.send).not.toHaveBeenCalled()
    expect(chat().draft).toBe("what's on my screen?")
    expect(captures().attachment).not.toBeNull()

    chat().send("what's on my screen?")
    expect(api.send).toHaveBeenCalledOnce()
    expect(chat().messages[0]?.attachment).toBeDefined()
  })

  it('does not capture again if the user removed the offered screenshot', async () => {
    api.take.mockResolvedValueOnce({ status: 'captured', capture: capture() })
    chat().send('explain this page')
    await flush()
    captures().remove()
    chat().send('explain this page')
    expect(api.take).toHaveBeenCalledOnce()
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ captureId: null }))
  })

  it('respects the setting', () => {
    useSettingsStore.setState({ settings: settings(false) })
    chat().send("what's on my screen?")
    expect(api.take).not.toHaveBeenCalled()
    expect(api.send).toHaveBeenCalledOnce()
  })

  it('never captures for ordinary questions', () => {
    chat().send('What can you do?')
    expect(api.take).not.toHaveBeenCalled()
  })
})

describe('conversation lifecycle', () => {
  it('new chat resets main and frees a pending attachment', () => {
    const c = capture()
    useCaptureStore.setState({ attachment: c })
    chat().newChat()
    expect(api.reset).toHaveBeenCalledOnce()
    expect(api.discard).toHaveBeenCalledWith(c.captureId)
    expect(chat().messages).toEqual([])
  })

  it('restores a saved conversation without images', async () => {
    api.history.mockResolvedValueOnce({
      messages: [
        { role: 'user', text: 'Why this error?', hadImage: true },
        { role: 'assistant', text: 'Because…', hadImage: false },
      ],
    })
    await chat().loadHistory()
    expect(chat().messages).toMatchObject([
      { role: 'user', text: 'Why this error?', attachment: { source: 'earlier' } },
      { role: 'assistant', text: 'Because…', state: 'done' },
    ])
  })

  it('remembers that a question was spoken, through edits, and marks its answer', () => {
    chat().setDraft('how do i fix it', true)
    chat().setDraft('How do I fix it?')
    chat().send('How do I fix it?')
    const turnId = lastTurn()
    expect(chat().messages[0]?.viaVoice).toBe(true)
    event({ type: 'started', turnId })
    expect(chat().messages[1]?.viaVoice).toBe(true)
    expect(chat().draftViaVoice).toBe(false)
  })

  it('typed questions are not marked as spoken; clearing a transcript resets it', () => {
    chat().setDraft('dictated', true)
    chat().setDraft('')
    chat().send('typed instead')
    event({ type: 'started', turnId: lastTurn() })
    expect(chat().messages.every((m) => m.viaVoice === undefined)).toBe(true)
  })
})
