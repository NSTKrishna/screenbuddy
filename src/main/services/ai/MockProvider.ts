import { MOCK_FAIL_COMMAND } from '@shared/mock'
import {
  ProviderError,
  type ChatProvider,
  type ProviderImage,
  type ProviderRequest,
  type StreamOptions,
  type StreamResult,
} from './types'

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export function pickMockReply(
  prompt: string,
  image: ProviderImage | undefined,
  turn: number,
): string {
  const followUp =
    turn > 1 ? `(Mock mode remembers this conversation: this is message ${turn}.)\n\n` : ''
  if (image !== undefined) {
    return `${followUp}I received a screenshot (${image.width}×${image.height}). Mock mode doesn't analyse images, so I can't tell you what's on it.\n\nTo get real answers, choose an OpenAI-compatible provider in Settings. Nothing was uploaded: in mock mode the image never leaves your Mac.`
  }
  const p = prompt.toLowerCase()
  if (/^(hi|hey|hello|yo)\b/.test(p)) {
    return `${followUp}Hi! I'm ScreenBuddy, running in mock mode with simulated replies. Connect an AI provider in Settings and I'll answer questions about whatever is on your screen.`
  }
  if (/\b(what can you do|help|features?)\b/.test(p)) {
    return `${followUp}I can look at your screen when you ask (and only when you ask), explain what you're seeing, and walk you through tasks step by step.\n\nRight now I'm in mock mode, so every reply is simulated. Choose a provider in Settings for real answers.`
  }
  if (/\b(shortcut|hotkey|keyboard)\b/.test(p)) {
    return `${followUp}Press ⌘ ⇧ Space from any app to bring me up, and press it again to tuck me away. You can drag me anywhere on screen, and I'll remember where you left me.`
  }
  return `${followUp}This is a simulated reply from mock mode. You asked: “${truncate(prompt.trim(), 80)}”\n\nConnect a provider in Settings and real answers will stream in right here.`
}

/** Splits text into word-sized chunks, keeping the whitespace that follows each word. */
export function chunkWords(text: string): string[] {
  return text.match(/\s*\S+\s*/g) ?? []
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = (): Error =>
      signal.reason instanceof Error ? signal.reason : new Error('aborted')
    if (signal.aborted) {
      reject(aborted())
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(aborted())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface MockProviderOptions {
  thinkMs?: readonly [min: number, max: number]
  wordMs?: readonly [min: number, max: number]
  random?: () => number
}

/**
 * Free, offline replies that go through the same streaming path as a real
 * provider, so the whole app can be used and tested without an API key.
 */
export class MockProvider implements ChatProvider {
  readonly name = 'mock'
  private readonly thinkMs: readonly [number, number]
  private readonly wordMs: readonly [number, number]
  private readonly random: () => number

  constructor(options: MockProviderOptions = {}) {
    this.thinkMs = options.thinkMs ?? [500, 900]
    this.wordMs = options.wordMs ?? [15, 45]
    this.random = options.random ?? Math.random
  }

  async stream(request: ProviderRequest, options: StreamOptions): Promise<StreamResult> {
    const between = ([min, max]: readonly [number, number]): number =>
      min + this.random() * (max - min)
    const users = request.messages.filter((m) => m.role === 'user')
    const last = users.at(-1)
    options.onConnected()
    await sleep(between(this.thinkMs), options.signal)
    if (last?.text.trim() === MOCK_FAIL_COMMAND) {
      // Not retryable, so the error shows at once; the error card still offers Retry.
      throw new ProviderError('PROVIDER_UNAVAILABLE', false, {
        publicMessage: "Couldn't reach the assistant. This was a simulated error.",
      })
    }
    for (const chunk of chunkWords(pickMockReply(last?.text ?? '', last?.image, users.length))) {
      await sleep(between(this.wordMs), options.signal)
      options.onDelta(chunk)
    }
    return { truncated: false }
  }
}
