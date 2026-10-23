import type { ChatErrorCode } from '@shared/schemas/chat'

export interface ProviderImage {
  mimeType: 'image/jpeg'
  base64: string
  width: number
  height: number
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  text: string
  image?: ProviderImage
}

export interface ProviderRequest {
  model: string
  messages: ProviderMessage[]
  maxTokens: number
  temperature?: number
}

export interface StreamOptions {
  signal: AbortSignal
  /** The provider accepted the request and is working on an answer. */
  onConnected: () => void
  onDelta: (text: string) => void
}

export interface StreamResult {
  /** The answer was cut off by the token limit. */
  truncated: boolean
}

/**
 * A model backend. Implementations translate to and from one wire format and
 * nothing else: retries, timeouts, context and UI events are AiService's job.
 */
export interface ChatProvider {
  readonly name: string
  stream: (request: ProviderRequest, options: StreamOptions) => Promise<StreamResult>
}

/** A classified provider failure. Its message is internal and never shown or logged with bodies. */
export class ProviderError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    readonly retryable: boolean,
    readonly details: {
      status?: number
      retryAfterMs?: number
      /** Only for ScreenBuddy's own mock provider: text shown to the user as is. */
      publicMessage?: string
    } = {},
  ) {
    super(
      `provider error ${code}${details.status === undefined ? '' : ` (HTTP ${details.status})`}`,
    )
    this.name = 'ProviderError'
  }
}
