import { checkBaseUrl, isLocalBaseUrl } from '@shared/baseUrl'
import type {
  ChatAccepted,
  ChatError,
  ChatErrorCode,
  ChatEvent,
  ChatHistory,
  ChatRetryRequest,
  ChatSendRequest,
  ConnectionTestResult,
  HistoryMessage,
} from '@shared/schemas/chat'
import type { AiConfig } from '@shared/schemas/settings'
import type { CaptureStore } from '../capture/CaptureStore'
import type { ConversationStore } from '../storage/ConversationStore'
import { buildContext, type Turn } from './context'
import { PING_PROMPT } from './prompts'
import { ProviderError, type ChatProvider, type ProviderImage, type ProviderRequest } from './types'

export interface AiTimeouts {
  /** From sending the request to the first word of the answer. Vision models can be slow. */
  firstTokenMs: number
  /** Longest pause allowed between words once the answer is streaming. */
  idleMs: number
  /** Hard cap for the whole turn, retries included. */
  totalMs: number
}

export const DEFAULT_TIMEOUTS: AiTimeouts = {
  firstTokenMs: 60_000,
  idleMs: 30_000,
  totalMs: 180_000,
}
export const MAX_ATTEMPTS = 3
const DEFAULT_MAX_TOKENS = 1024

const MESSAGES: Record<ChatErrorCode, string> = {
  NOT_CONFIGURED:
    'The AI provider isn’t set up yet. Add a base URL, model and API key in Settings, or switch to mock mode.',
  INVALID_API_KEY: 'The provider rejected the API key. Check it in Settings.',
  PROVIDER_UNAVAILABLE: 'Couldn’t reach the AI provider. Check your connection and the base URL.',
  RATE_LIMITED:
    'The provider is limiting requests, or your quota has run out. Wait a moment, then try again.',
  TIMEOUT: 'The provider took too long to answer.',
  VISION_UNSUPPORTED:
    'This model can’t read images. Send without the screenshot, or choose a vision model in Settings.',
  IMAGE_EXPIRED: 'The screenshot is no longer available. Capture it again, or send without it.',
  CONTEXT_TOO_LONG: 'This conversation is too long for the model. Start a new chat.',
  MODEL_NOT_FOUND:
    'The provider doesn’t know that model, or the base URL is wrong. Check Settings.',
  BAD_REQUEST: 'The provider refused the request.',
  PROVIDER_ERROR: 'The AI provider had a problem answering. Try again.',
  BUSY: 'Wait for the current answer to finish, or stop it.',
  NOTHING_TO_RETRY: 'There’s nothing to retry.',
}

/** Whether a plain Retry can help. The others need a change first (settings, image, new chat). */
const RETRYABLE: Record<ChatErrorCode, boolean> = {
  NOT_CONFIGURED: true,
  INVALID_API_KEY: true,
  PROVIDER_UNAVAILABLE: true,
  RATE_LIMITED: true,
  TIMEOUT: true,
  VISION_UNSUPPORTED: false,
  IMAGE_EXPIRED: false,
  CONTEXT_TOO_LONG: false,
  MODEL_NOT_FOUND: true,
  BAD_REQUEST: true,
  PROVIDER_ERROR: true,
  BUSY: false,
  NOTHING_TO_RETRY: false,
}

export function chatError(code: ChatErrorCode, message: string = MESSAGES[code]): ChatError {
  return { code, message, retryable: RETRYABLE[code] }
}

function fromProviderError(error: unknown): ChatError {
  if (error instanceof ProviderError) return chatError(error.code, error.details.publicMessage)
  return chatError('PROVIDER_ERROR')
}

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

export interface AiServiceDeps {
  config: () => AiConfig
  apiKey: () => string | null
  captures: CaptureStore
  providerFor: (config: AiConfig, apiKey: string | null) => ChatProvider
  emit: (event: ChatEvent) => void
  history: { enabled: () => boolean; store: ConversationStore }
  timeouts?: AiTimeouts
  backoffBaseMs?: number
  maxTokens?: number
  random?: () => number
  log?: (message: string) => void
  /** A finished answer, and the display its screenshot showed (null without one). */
  onAnswer?: (answer: { text: string; displayId: number | null }) => void
}

type Outcome =
  { kind: 'done'; truncated: boolean } | { kind: 'stopped' } | { kind: 'error'; error: ChatError }

/**
 * The conversation and every request to the model. Provider-agnostic: it
 * handles context, retries, timeouts, cancellation and image lifetime, and
 * talks to whichever ChatProvider the settings select.
 *
 * Main is the source of truth for the conversation (D-013); the renderer
 * mirrors it from `chat:event`s.
 */
export class AiService {
  private turns: Turn[] = []
  private active: { turnId: string; abort: (reason: 'canceled' | 'timeout') => void } | null = null
  /** The last failed turn, kept (with its screenshot) so Retry can resend it. */
  private pending: { turnIndex: number; captureId: string | null } | null = null
  /** Bumped by reset(); a run from an older generation stays silent. */
  private generation = 0
  private timeouts: AiTimeouts
  private backoffBaseMs: number
  private readonly log: (message: string) => void

  constructor(private readonly deps: AiServiceDeps) {
    this.timeouts = deps.timeouts ?? DEFAULT_TIMEOUTS
    this.backoffBaseMs = deps.backoffBaseMs ?? 800
    this.log = deps.log ?? (() => undefined)
    if (deps.history.enabled()) this.turns = toTurns(deps.history.store.load())
  }

  /** The saved conversation, for the renderer to show after a launch. */
  history(): ChatHistory {
    return { messages: this.flatten() }
  }

  send(request: ChatSendRequest): ChatAccepted {
    if (this.active !== null) return { accepted: false, error: chatError('BUSY') }
    this.abandonPending()
    this.turns.push({
      user: { text: request.text, hadImage: request.captureId !== null },
      assistant: null,
      failed: false,
    })
    void this.run(this.turns.length - 1, request.turnId, request.captureId)
    return { accepted: true }
  }

  retry(request: ChatRetryRequest): ChatAccepted {
    if (this.active !== null) return { accepted: false, error: chatError('BUSY') }
    const pending = this.pending
    const turn = pending === null ? undefined : this.turns[pending.turnIndex]
    if (pending === null || turn === undefined) {
      return { accepted: false, error: chatError('NOTHING_TO_RETRY') }
    }
    this.pending = null
    let captureId = pending.captureId
    if (request.withoutImage && captureId !== null) {
      this.deps.captures.delete(captureId)
      captureId = null
      turn.user.hadImage = false
    }
    turn.failed = false
    void this.run(pending.turnIndex, request.turnId, captureId)
    return { accepted: true }
  }

  cancel(turnId: string): void {
    if (this.active?.turnId === turnId) this.active.abort('canceled')
  }

  /** New chat: stop anything running and forget the conversation, on disk too. */
  reset(): void {
    this.generation += 1
    this.active?.abort('canceled')
    this.active = null
    this.abandonPending()
    this.turns = []
    void this.deps.history.store.clear()
  }

  /** Called when the user turns history saving on or off. */
  historyChanged(enabled: boolean): void {
    if (enabled) void this.deps.history.store.save(this.flatten())
    else void this.deps.history.store.clear()
  }

  /** For E2E: short timeouts and backoff so failure paths run quickly. */
  setTimingForTests(timeouts: AiTimeouts, backoffBaseMs: number): void {
    this.timeouts = timeouts
    this.backoffBaseMs = backoffBaseMs
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const config = this.deps.config()
    const apiKey = this.deps.apiKey()
    if (config.provider === 'mock') {
      return { ok: true, code: null, message: 'Mock mode is on. No connection is needed.' }
    }
    const problem = preflight(config, apiKey)
    if (problem !== null) return { ok: false, code: problem.code, message: problem.message }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      await this.deps
        .providerFor(config, apiKey)
        .stream(
          { model: config.model, messages: [{ role: 'user', text: PING_PROMPT }], maxTokens: 5 },
          { signal: controller.signal, onConnected: () => undefined, onDelta: () => undefined },
        )
      return { ok: true, code: null, message: `Connected. ${config.model} answered.` }
    } catch (error) {
      const e = controller.signal.aborted ? chatError('TIMEOUT') : fromProviderError(error)
      this.log(`ai: connection test failed (${e.code})`)
      return { ok: false, code: e.code, message: e.message }
    } finally {
      clearTimeout(timer)
    }
  }

  private async run(turnIndex: number, turnId: string, captureId: string | null): Promise<void> {
    const generation = this.generation
    const current = (): boolean => generation === this.generation
    const emit = (event: ChatEvent): void => {
      if (current()) this.deps.emit(event)
    }
    const turn = this.turns[turnIndex]
    if (turn === undefined) return

    const fail = (error: ChatError): void => {
      turn.failed = true
      this.pending = { turnIndex, captureId }
      this.log(`ai: turn failed (${error.code})`)
      emit({ type: 'error', turnId, error })
    }

    const config = this.deps.config()
    const apiKey = this.deps.apiKey()
    const problem = preflight(config, apiKey)
    if (problem !== null) {
      fail(problem)
      return
    }

    let image: ProviderImage | undefined
    let displayId: number | null = null
    if (captureId !== null) {
      if (!config.supportsVision) {
        fail(
          chatError(
            'VISION_UNSUPPORTED',
            'This model is set up as text-only, so the screenshot wasn’t sent. Send without it, or turn on image support in Settings.',
          ),
        )
        return
      }
      const stored = this.deps.captures.get(captureId)
      if (stored === undefined) {
        fail(chatError('IMAGE_EXPIRED'))
        return
      }
      displayId = stored.displayId
      image = {
        mimeType: 'image/jpeg',
        base64: stored.jpeg.toString('base64'),
        width: stored.width,
        height: stored.height,
      }
    }

    const request = {
      model: config.model,
      messages: buildContext(this.turns.slice(0, turnIndex), {
        text: turn.user.text,
        ...(image === undefined ? {} : { image }),
      }),
      maxTokens: this.deps.maxTokens ?? DEFAULT_MAX_TOKENS,
    }
    const provider = this.deps.providerFor(config, apiKey)

    const { outcome, text } = await this.attempts(provider, request, turnId, emit)

    if (!current()) {
      // A new chat started meanwhile; this turn no longer exists.
      if (captureId !== null) this.deps.captures.delete(captureId)
      return
    }
    if (outcome.kind === 'error') {
      fail(outcome.error)
      return
    }
    // The request is complete, so the image is no longer needed anywhere (D-032).
    if (captureId !== null) this.deps.captures.delete(captureId)
    turn.assistant = { text, stopped: outcome.kind === 'stopped' }
    turn.failed = false
    emit({
      type: 'done',
      turnId,
      stopped: outcome.kind === 'stopped',
      truncated: outcome.kind === 'done' && outcome.truncated,
    })
    if (this.deps.history.enabled()) void this.deps.history.store.save(this.flatten())
    if (outcome.kind === 'done') this.deps.onAnswer?.({ text, displayId })
  }

  /**
   * Sends one request, retrying with backoff on transient failures, but only
   * before the first word arrives (retrying later would repeat text). Applies
   * the first-word, idle and total timeouts, and honours cancel().
   */
  private async attempts(
    provider: ChatProvider,
    request: ProviderRequest,
    turnId: string,
    emit: (event: ChatEvent) => void,
  ): Promise<{ outcome: Outcome; text: string }> {
    // Mutated from callbacks and timers, so kept in one object.
    const state: { text: string; started: boolean; stop: 'canceled' | 'timeout' | null } = {
      text: '',
      started: false,
      stop: null,
    }
    let attempt: AbortController | null = null
    const backoff = new AbortController()
    const abort = (reason: 'canceled' | 'timeout'): void => {
      state.stop ??= reason
      attempt?.abort()
      backoff.abort()
    }
    this.active = { turnId, abort }
    const totalTimer = setTimeout(() => abort('timeout'), this.timeouts.totalMs)
    const stopped = (): Outcome =>
      state.stop === 'timeout'
        ? { kind: 'error', error: chatError('TIMEOUT') }
        : { kind: 'stopped' }

    try {
      for (let n = 1; ; n++) {
        emit({
          type: 'progress',
          turnId,
          stage: n === 1 ? 'connecting' : 'retrying',
          attempt: n,
          maxAttempts: MAX_ATTEMPTS,
        })
        attempt = new AbortController()
        let wordTimer = setTimeout(() => abort('timeout'), this.timeouts.firstTokenMs)
        try {
          const result = await provider.stream(request, {
            signal: attempt.signal,
            onConnected: () => {
              emit({
                type: 'progress',
                turnId,
                stage: 'waiting',
                attempt: n,
                maxAttempts: MAX_ATTEMPTS,
              })
            },
            onDelta: (delta) => {
              if (state.stop !== null) return
              if (!state.started) {
                state.started = true
                emit({ type: 'started', turnId })
              }
              state.text += delta
              emit({ type: 'delta', turnId, text: delta })
              clearTimeout(wordTimer)
              wordTimer = setTimeout(() => abort('timeout'), this.timeouts.idleMs)
            },
          })
          return { outcome: { kind: 'done', truncated: result.truncated }, text: state.text }
        } catch (error) {
          if (state.stop !== null) return { outcome: stopped(), text: state.text }
          const retryable = error instanceof ProviderError && error.retryable
          if (!retryable || state.started || n >= MAX_ATTEMPTS) {
            return { outcome: { kind: 'error', error: fromProviderError(error) }, text: state.text }
          }
          const wait =
            error.details.retryAfterMs ??
            this.backoffBaseMs * 2 ** (n - 1) * (0.75 + (this.deps.random ?? Math.random)() * 0.5)
          this.log(`ai: attempt ${n} failed (${error.code}), retrying`)
          try {
            await sleep(wait, backoff.signal)
          } catch {
            return { outcome: stopped(), text: state.text }
          }
        } finally {
          clearTimeout(wordTimer)
        }
      }
    } finally {
      clearTimeout(totalTimer)
      this.release(turnId)
    }
  }

  /** Clears the active turn, unless a newer one has already taken its place. */
  private release(turnId: string): void {
    if (this.active?.turnId === turnId) this.active = null
  }

  /** A failed turn the user moved on from: drop its image and keep it out of the context. */
  private abandonPending(): void {
    if (this.pending?.captureId != null) this.deps.captures.delete(this.pending.captureId)
    this.pending = null
  }

  private flatten(): HistoryMessage[] {
    const messages: HistoryMessage[] = []
    for (const turn of this.turns) {
      if (turn.failed) continue
      messages.push({ role: 'user', text: turn.user.text, hadImage: turn.user.hadImage })
      if (turn.assistant !== null && turn.assistant.text !== '') {
        messages.push({ role: 'assistant', text: turn.assistant.text, hadImage: false })
      }
    }
    return messages
  }
}

function preflight(config: AiConfig, apiKey: string | null): ChatError | null {
  if (config.provider === 'mock') return null
  if (!checkBaseUrl(config.baseUrl).ok || config.model === '') return chatError('NOT_CONFIGURED')
  // Local servers (Ollama, LM Studio) usually need no key.
  if (apiKey === null && !isLocalBaseUrl(config.baseUrl)) return chatError('NOT_CONFIGURED')
  return null
}

function toTurns(messages: HistoryMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ user: { text: m.text, hadImage: m.hadImage }, assistant: null, failed: false })
    } else {
      const last = turns.at(-1)
      if (last !== undefined && last.assistant === null)
        last.assistant = { text: m.text, stopped: false }
    }
  }
  return turns
}
