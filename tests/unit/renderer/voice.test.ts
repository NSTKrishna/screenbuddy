import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicSettings } from '@shared/schemas/settings'
import {
  VoiceSettings,
  type MicPermissionInfo,
  type TranscribeOutcome,
} from '@shared/schemas/voice'
import { DEFAULT_VAD, rms, VoiceActivity } from '../../../src/renderer/assistant/lib/audio/vad'
import { sentences, spokenText } from '../../../src/renderer/assistant/lib/speech/spokenText'

// ---------------------------------------------------------------------------
// Fakes for the microphone and the speech engines (jsdom has neither).

const recorder = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  autoStop: null as (() => void) | null,
}))

vi.mock('../../../src/renderer/assistant/lib/audio/recorder', () => {
  class MicrophoneError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    MicrophoneError,
    startRecording: (events: { onAutoStop: () => void }) => {
      recorder.autoStop = events.onAutoStop
      return recorder.start() as Promise<unknown>
    },
  }
})

const speech = vi.hoisted(() => ({
  speak: vi.fn(),
  stop: vi.fn(),
  finish: null as (() => void) | null,
}))

vi.mock('../../../src/renderer/assistant/lib/speech/engines', () => {
  class Engine {
    speak(text: string) {
      speech.speak(text)
      return new Promise<void>((resolve) => {
        speech.finish = resolve
      })
    }
    stop() {
      speech.stop()
      speech.finish?.()
    }
    setVolume() {}
  }
  return {
    SystemSpeechEngine: Engine,
    ProviderSpeechEngine: Engine,
    SpeechEngineError: class extends Error {},
  }
})

const { useVoiceStore, speakAnswersToSpokenQuestions } =
  await import('../../../src/renderer/assistant/stores/useVoiceStore')
const { useChatStore } = await import('../../../src/renderer/assistant/stores/useChatStore')
const { useSettingsStore } = await import('../../../src/renderer/assistant/stores/useSettingsStore')
const { MicrophoneError } = await import('../../../src/renderer/assistant/lib/audio/recorder')

// ---------------------------------------------------------------------------

describe('VoiceActivity', () => {
  const feed = (vad: VoiceActivity, level: number, ms: number) => {
    let decision = 'continue'
    for (let t = 0; t < ms && decision === 'continue'; t += 50) decision = vad.push(level, 50)
    return decision
  }

  it('silence: gives up after the no-speech limit and reports nothing heard', () => {
    const vad = new VoiceActivity()
    expect(feed(vad, 0.001, DEFAULT_VAD.noSpeechMs + 100)).toBe('no-speech')
    expect(vad.heardSpeech).toBe(false)
  })

  it('stops after a pause once someone has spoken', () => {
    const vad = new VoiceActivity()
    expect(feed(vad, 0.1, 1200)).toBe('continue')
    expect(feed(vad, 0.001, DEFAULT_VAD.silenceStopMs + 100)).toBe('silence')
    expect(vad.heardSpeech).toBe(true)
  })

  it('a short utterance still counts as speech', () => {
    const vad = new VoiceActivity()
    feed(vad, 0.1, 250)
    feed(vad, 0.001, 500)
    expect(vad.heardSpeech).toBe(true)
  })

  it('a click or a pop does not', () => {
    const vad = new VoiceActivity()
    feed(vad, 0.5, 50)
    feed(vad, 0.001, 1000)
    expect(vad.heardSpeech).toBe(false)
  })

  it('stops at the hard cap', () => {
    const vad = new VoiceActivity({ ...DEFAULT_VAD, maxMs: 1000 })
    expect(feed(vad, 0.1, 2000)).toBe('max')
  })

  it('computes RMS', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array([]))).toBe(0)
  })
})

describe('spokenText', () => {
  it('mentions code instead of reading it, and drops formatting and links', () => {
    const text = spokenText(
      '**Fix:** run this:\n\n```sh\nnpm install\n```\n\nSee [the docs](https://x.test) and `tsconfig.json`.\n\n- one\n- two',
    )
    expect(text).toBe(
      'Fix: run this: There’s a code snippet in the chat. See the docs and tsconfig.json. one two',
    )
  })

  it('cuts long answers at a sentence and says the rest is on screen', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const text = spokenText(long, 200)
    expect(text.length).toBeLessThan(260)
    expect(text.endsWith('The rest is in the chat.')).toBe(true)
  })

  it('splits into short utterances', () => {
    const parts = sentences(`One. Two? ${'word '.repeat(100)}end.`)
    expect(parts[0]).toBe('One.')
    expect(parts[1]).toBe('Two?')
    expect(parts.every((p) => p.length <= 220)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

const granted: MicPermissionInfo = { status: 'granted', grantee: 'Electron', canOpenSettings: true }

const api = {
  begin: vi.fn<() => Promise<MicPermissionInfo>>(),
  end: vi.fn(() => Promise.resolve()),
  transcribe: vi.fn<(r: { requestId: string; bytes: Uint8Array }) => Promise<TranscribeOutcome>>(),
  cancelTranscription: vi.fn(() => Promise.resolve()),
  send: vi.fn(() => Promise.resolve({ accepted: true as const })),
  cancel: vi.fn(() => Promise.resolve()),
}

function settings(voice: Partial<VoiceSettings> = {}): PublicSettings {
  return {
    shortcut: 'x',
    showDockIcon: false,
    autoCaptureScreenQuestions: false,
    saveHistory: false,
    annotationSeconds: 8,
    voice: { ...VoiceSettings.parse({}), ...voice },
    ai: {
      provider: 'mock',
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
      supportsVision: true,
    },
    apiKey: { present: false, hint: null, storage: 'none' },
  }
}

const voice = useVoiceStore.getState
const chat = useChatStore.getState
const flush = () => new Promise((r) => setTimeout(r, 0))

function speechClip(heardSpeech = true) {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationMs: 900,
    heardSpeech,
  }
}

async function record(clip = speechClip()) {
  recorder.stop.mockResolvedValueOnce(clip)
  await voice().startListening()
  expect(voice().phase).toBe('listening')
  await voice().stopListening()
}

let unsubscribe: () => void = () => undefined

beforeEach(() => {
  vi.clearAllMocks()
  unsubscribe()
  api.begin.mockResolvedValue(granted)
  api.transcribe.mockResolvedValue({ status: 'ok', text: 'How do I fix it?' })
  recorder.start.mockResolvedValue({ stop: recorder.stop, cancel: recorder.cancel })
  Object.defineProperty(window, 'screenBuddy', {
    configurable: true,
    value: {
      voice: {
        begin: api.begin,
        end: api.end,
        transcribe: api.transcribe,
        cancelTranscription: api.cancelTranscription,
      },
      chat: { send: api.send, cancel: api.cancel, reset: () => Promise.resolve(), retry: api.send },
      capture: { discard: () => Promise.resolve() },
      settings: { update: () => Promise.resolve(useSettingsStore.getState().settings) },
    },
  })
  useSettingsStore.setState({ settings: settings() })
  useVoiceStore.setState({
    phase: 'idle',
    error: null,
    partial: '',
    speakingId: null,
    canRetry: false,
  })
  chat().newChat()
  unsubscribe = speakAnswersToSpokenQuestions()
})

describe('voice input', () => {
  it('asks main first, records, transcribes, and leaves the transcript to edit', async () => {
    await record()
    expect(api.begin).toHaveBeenCalledOnce()
    expect(api.end).toHaveBeenCalled()
    expect(api.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/webm', bytes: new Uint8Array([1, 2, 3, 4]) }),
    )
    expect(chat()).toMatchObject({ draft: 'How do I fix it?', draftViaVoice: true })
    expect(api.send).not.toHaveBeenCalled()
    expect(voice().phase).toBe('idle')
  })

  it('sends straight away when auto-send is on', async () => {
    useSettingsStore.setState({ settings: settings({ autoSend: true }) })
    await record()
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ text: 'How do I fix it?' }))
    expect(chat().messages[0]?.viaVoice).toBe(true)
  })

  it('permission denied: never opens the microphone', async () => {
    api.begin.mockResolvedValueOnce({ ...granted, status: 'denied' })
    await voice().startListening()
    expect(recorder.start).not.toHaveBeenCalled()
    expect(voice()).toMatchObject({ phase: 'idle', error: { code: 'MIC_DENIED' } })
    expect(api.end).toHaveBeenCalled()
  })

  it('microphone unavailable: explains it and releases the gate', async () => {
    recorder.start.mockRejectedValueOnce(new MicrophoneError('MIC_UNAVAILABLE'))
    await voice().startListening()
    expect(voice().error?.code).toBe('MIC_UNAVAILABLE')
    expect(api.end).toHaveBeenCalled()
  })

  it('silence: nothing is sent anywhere', async () => {
    await record(speechClip(false))
    expect(api.transcribe).not.toHaveBeenCalled()
    expect(voice().error?.code).toBe('NO_SPEECH')
  })

  it('an empty transcript is treated as silence too', async () => {
    api.transcribe.mockResolvedValueOnce({ status: 'ok', text: '  ' })
    await record()
    expect(voice().error?.code).toBe('NO_SPEECH')
    expect(chat().draft).toBe('')
  })

  it('voice activity stopping the recording transcribes it', async () => {
    recorder.stop.mockResolvedValueOnce(speechClip())
    await voice().startListening()
    recorder.autoStop?.()
    await vi.waitFor(() => expect(api.transcribe).toHaveBeenCalledOnce())
  })

  it('network disconnect: keeps the clip in memory for Retry, until dismissed', async () => {
    api.transcribe.mockResolvedValueOnce({
      status: 'failed',
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'offline', retryable: true },
    })
    await record()
    expect(voice()).toMatchObject({ error: { code: 'PROVIDER_UNAVAILABLE' }, canRetry: true })
    voice().retryTranscription()
    await vi.waitFor(() => expect(chat().draft).toBe('How do I fix it?'))
    expect(api.transcribe).toHaveBeenCalledTimes(2)

    api.transcribe.mockResolvedValueOnce({
      status: 'failed',
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'offline', retryable: true },
    })
    await record()
    voice().dismissError()
    voice().retryTranscription()
    expect(api.transcribe).toHaveBeenCalledTimes(3)
  })

  it('cancel while listening throws the audio away', async () => {
    await voice().startListening()
    voice().cancel()
    expect(recorder.cancel).toHaveBeenCalledOnce()
    expect(api.transcribe).not.toHaveBeenCalled()
    expect(voice().phase).toBe('idle')
  })

  it('cancel while transcribing tells main and ignores the late result', async () => {
    let resolve: (o: TranscribeOutcome) => void = () => undefined
    api.transcribe.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    recorder.stop.mockResolvedValueOnce(speechClip())
    await voice().startListening()
    void voice().stopListening()
    await vi.waitFor(() => expect(voice().phase).toBe('transcribing'))
    voice().cancel()
    expect(api.cancelTranscription).toHaveBeenCalledOnce()
    resolve({ status: 'ok', text: 'too late' })
    await flush()
    expect(chat().draft).toBe('')
  })

  it('shows live partial text for the current request only', async () => {
    let requestId = ''
    api.transcribe.mockImplementationOnce((r) => {
      requestId = r.requestId
      voice().handlePartial('00000000-0000-4000-8000-0000000000ff', 'not mine')
      voice().handlePartial(requestId, 'How do')
      expect(voice().partial).toBe('How do')
      return Promise.resolve({ status: 'ok', text: 'How do I fix it?' })
    })
    await record()
    expect(voice().partial).toBe('')
  })

  it('text-only mode never starts listening', async () => {
    useSettingsStore.setState({ settings: settings({ mode: 'text' }) })
    await voice().startListening()
    expect(api.begin).not.toHaveBeenCalled()
  })

  it('hiding the window stops a recording', async () => {
    await voice().startListening()
    voice().onHidden()
    expect(recorder.cancel).toHaveBeenCalledOnce()
    expect(voice().phase).toBe('idle')
  })
})

describe('spoken answers', () => {
  const answer = (text: string) => {
    const turnId = chat().activeTurnId ?? ''
    chat().handleEvent({ type: 'started', turnId })
    chat().handleEvent({ type: 'delta', turnId, text })
    chat().handleEvent({ type: 'done', turnId, stopped: false, truncated: false })
  }

  it('reads the answer to a spoken question aloud, but not to a typed one', async () => {
    useSettingsStore.setState({ settings: settings({ autoSend: true }) })
    await record()
    answer('Change the **type**.')
    expect(speech.speak).toHaveBeenCalledWith('Change the type.')
    expect(voice().phase).toBe('speaking')
    speech.finish?.()
    await flush()
    expect(voice().phase).toBe('idle')

    chat().send('typed question')
    answer('Quiet answer.')
    expect(speech.speak).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when muted', async () => {
    useSettingsStore.setState({ settings: settings({ autoSend: true, speakResponses: false }) })
    await record()
    answer('Nothing to hear.')
    expect(speech.speak).not.toHaveBeenCalled()
  })

  it('speech interruption: the mic button stops speaking before it listens', async () => {
    useSettingsStore.setState({ settings: settings({ autoSend: true }) })
    await record()
    answer('A long answer.')
    expect(voice().phase).toBe('speaking')
    voice().toggleListening()
    await vi.waitFor(() => expect(voice().phase).toBe('listening'))
    expect(speech.stop).toHaveBeenCalled()
  })

  it('Esc (cancel) stops speaking', () => {
    void voice().speak('m1', 'Hello there.')
    expect(voice().phase).toBe('speaking')
    voice().cancel()
    expect(voice().phase).toBe('idle')
  })

  it('a new spoken question interrupts an answer that is still streaming', async () => {
    chat().send('typed')
    expect(chat().status).toBe('thinking')
    await voice().startListening()
    expect(api.cancel).toHaveBeenCalled()
  })

  it('handles several questions in a row', async () => {
    useSettingsStore.setState({ settings: settings({ autoSend: true }) })
    for (const [i, q] of ['First?', 'Second?', 'Third?'].entries()) {
      api.transcribe.mockResolvedValueOnce({ status: 'ok', text: q })
      await record()
      answer(`Answer ${i + 1}.`)
      speech.finish?.()
      await flush()
    }
    expect(
      chat()
        .messages.filter((m) => m.role === 'user')
        .map((m) => m.text),
    ).toEqual(['First?', 'Second?', 'Third?'])
    expect(speech.speak.mock.calls.map(([t]) => t as string)).toEqual([
      'Answer 1.',
      'Answer 2.',
      'Answer 3.',
    ])
  })
})
