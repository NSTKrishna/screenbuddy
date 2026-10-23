import { z } from 'zod'

export const MAX_PROMPT_LENGTH = 4000

const TurnId = z.uuid()

/** One question. `captureId` names an image already held in main; image bytes never travel here. */
export const ChatSendRequest = z.strictObject({
  turnId: TurnId,
  text: z.string().max(MAX_PROMPT_LENGTH),
  captureId: z.uuid().nullable(),
})
export type ChatSendRequest = z.infer<typeof ChatSendRequest>

/** Re-run the last failed question, optionally dropping its screenshot. */
export const ChatRetryRequest = z.strictObject({
  turnId: TurnId,
  withoutImage: z.boolean(),
})
export type ChatRetryRequest = z.infer<typeof ChatRetryRequest>

export const ChatErrorCode = z.enum([
  'NOT_CONFIGURED',
  'INVALID_API_KEY',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'TIMEOUT',
  'VISION_UNSUPPORTED',
  'IMAGE_EXPIRED',
  'CONTEXT_TOO_LONG',
  'MODEL_NOT_FOUND',
  'BAD_REQUEST',
  'PROVIDER_ERROR',
  'BUSY',
  'NOTHING_TO_RETRY',
])
export type ChatErrorCode = z.infer<typeof ChatErrorCode>

export const ChatError = z.object({
  code: ChatErrorCode,
  /** Written by ScreenBuddy, never copied from a provider response. */
  message: z.string().max(500),
  retryable: z.boolean(),
})
export type ChatError = z.infer<typeof ChatError>

export const ChatAccepted = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true) }),
  z.object({ accepted: z.literal(false), error: ChatError }),
])
export type ChatAccepted = z.infer<typeof ChatAccepted>

export const ChatProgressStage = z.enum(['connecting', 'waiting', 'retrying'])
export type ChatProgressStage = z.infer<typeof ChatProgressStage>

/** Main → renderer, one stream of these per turn. */
export const ChatEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    turnId: TurnId,
    stage: ChatProgressStage,
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
  }),
  z.object({ type: z.literal('started'), turnId: TurnId }),
  z.object({ type: z.literal('delta'), turnId: TurnId, text: z.string().max(20_000) }),
  z.object({
    type: z.literal('done'),
    turnId: TurnId,
    stopped: z.boolean(),
    /** True when the provider cut the answer short (max tokens). */
    truncated: z.boolean(),
  }),
  z.object({ type: z.literal('error'), turnId: TurnId, error: ChatError }),
])
export type ChatEvent = z.infer<typeof ChatEvent>

/** A message as saved or restored: text only, plus whether an image went with it. */
export const HistoryMessage = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(50_000),
  hadImage: z.boolean(),
})
export type HistoryMessage = z.infer<typeof HistoryMessage>

export const ChatHistory = z.object({ messages: z.array(HistoryMessage).max(500) })
export type ChatHistory = z.infer<typeof ChatHistory>

export const ConnectionTestResult = z.object({
  ok: z.boolean(),
  message: z.string().max(500),
  code: ChatErrorCode.nullable(),
})
export type ConnectionTestResult = z.infer<typeof ConnectionTestResult>

/** API keys: trimmed, single line. The length bound keeps payloads small. */
export const SetApiKeyRequest = z.strictObject({
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[^\s]+$/, 'API keys are a single token'),
})
