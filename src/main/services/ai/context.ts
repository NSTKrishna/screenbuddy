import { IMAGE_ONLY_PROMPT, SYSTEM_PROMPT } from './prompts'
import type { ProviderImage, ProviderMessage } from './types'

/** One exchange in the conversation, as AiService keeps it. Text only. */
export interface Turn {
  user: { text: string; hadImage: boolean }
  assistant: { text: string; stopped: boolean } | null
  /** Failed turns stay visible for Retry but are left out of the context. */
  failed: boolean
}

export interface ContextLimits {
  /** Earlier messages to include, not counting the system prompt and the current question. */
  maxHistoryMessages: number
  /** Rough budget for earlier messages, in characters (about 4 per token). */
  maxHistoryChars: number
  /** Any single earlier message longer than this is shortened. */
  maxMessageChars: number
}

export const DEFAULT_LIMITS: ContextLimits = {
  maxHistoryMessages: 16,
  maxHistoryChars: 24_000,
  maxMessageChars: 6_000,
}

const IMAGE_NOTE = '\n\n(A screenshot was attached to this message. It is no longer available.)'
const STOPPED_NOTE = '\n\n(The user stopped this answer before it finished.)'
const OMITTED_NOTE =
  '\n\nEarlier parts of this conversation were left out to keep the context short.'

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (shortened)`
}

/**
 * Builds the provider messages for one request: the system prompt, as many
 * recent exchanges as fit the limits, then the current question with its
 * image. Only the current question ever carries an image (D-032).
 */
export function buildContext(
  history: readonly Turn[],
  current: { text: string; image?: ProviderImage },
  limits: ContextLimits = DEFAULT_LIMITS,
): ProviderMessage[] {
  const earlier: ProviderMessage[] = []
  for (const turn of history) {
    if (turn.failed) continue
    earlier.push({
      role: 'user',
      text:
        shorten(turn.user.text || IMAGE_ONLY_PROMPT, limits.maxMessageChars) +
        (turn.user.hadImage ? IMAGE_NOTE : ''),
    })
    if (turn.assistant !== null && turn.assistant.text !== '') {
      earlier.push({
        role: 'assistant',
        text:
          shorten(turn.assistant.text, limits.maxMessageChars) +
          (turn.assistant.stopped ? STOPPED_NOTE : ''),
      })
    }
  }

  // Keep the newest messages that fit, then make sure the window starts on a user message.
  const kept: ProviderMessage[] = []
  let chars = 0
  for (let i = earlier.length - 1; i >= 0; i--) {
    const message = earlier[i]
    if (message === undefined) continue
    if (kept.length >= limits.maxHistoryMessages) break
    if (chars + message.text.length > limits.maxHistoryChars) break
    kept.unshift(message)
    chars += message.text.length
  }
  while (kept[0]?.role === 'assistant') kept.shift()
  const omitted = kept.length < earlier.length

  const question: ProviderMessage = {
    role: 'user',
    text: current.text.trim() === '' ? IMAGE_ONLY_PROMPT : current.text,
    ...(current.image === undefined ? {} : { image: current.image }),
  }
  return [
    { role: 'system', text: SYSTEM_PROMPT + (omitted ? OMITTED_NOTE : '') },
    ...kept,
    question,
  ]
}
