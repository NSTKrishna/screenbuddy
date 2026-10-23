import { z } from 'zod'
import { MAX_AUDIO_BYTES } from '../limits'

export { MAX_AUDIO_BYTES }

/** Where speech-to-text happens. `chat-provider` uses the AI provider's `/audio/transcriptions`. */
export const TranscriptionSource = z.enum(['chat-provider', 'mock'])
export type TranscriptionSource = z.infer<typeof TranscriptionSource>

/** How answers are read aloud. `system` is macOS's own offline voice (D-009). */
export const SpeechEngineKind = z.enum(['system', 'provider'])
export type SpeechEngineKind = z.infer<typeof SpeechEngineKind>

const Identifier = z
  .string()
  .trim()
  .max(100)
  .regex(/^[^\s]*$/, 'No spaces')

export const VoiceSettings = z.object({
  /** `text`: no microphone and nothing is spoken. `voice`: both are available. */
  mode: z.enum(['text', 'voice']).default('voice'),
  /** Read answers to spoken questions aloud. The header's mute button flips this. */
  speakResponses: z.boolean().default(true),
  /** Send a transcript straight away instead of leaving it in the box to edit. */
  autoSend: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(0.9),
  rate: z.number().min(0.5).max(2).default(1),
  /** Optional global shortcut (⌥⇧Space) that starts and stops listening. Off by default. */
  shortcutEnabled: z.boolean().default(false),
  transcription: z
    .object({
      source: TranscriptionSource.default('chat-provider'),
      model: Identifier.min(1).default('gpt-4o-mini-transcribe'),
      /** ISO-639-1 code such as "en"; empty means let the model detect it. */
      language: z
        .string()
        .trim()
        .regex(/^([a-z]{2})?$/, 'Two-letter language code')
        .default(''),
      /** Ask for live partial results (supported by gpt-4o-*-transcribe, not whisper-1). */
      stream: z.boolean().default(true),
    })
    .prefault({}),
  speech: z
    .object({
      engine: SpeechEngineKind.default('system'),
      /** A macOS voice name for `system`; empty means the default voice. */
      systemVoice: z.string().max(200).default(''),
      providerModel: Identifier.min(1).default('gpt-4o-mini-tts'),
      providerVoice: Identifier.min(1).default('alloy'),
    })
    .prefault({}),
})
export type VoiceSettings = z.infer<typeof VoiceSettings>

export const VOICE_SHORTCUT = 'Alt+Shift+Space'

export const MicPermissionStatus = z.enum([
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'unknown',
])
export type MicPermissionStatus = z.infer<typeof MicPermissionStatus>

export const MicPermissionInfo = z.object({
  status: MicPermissionStatus,
  grantee: z.string().max(100),
  canOpenSettings: z.boolean(),
})
export type MicPermissionInfo = z.infer<typeof MicPermissionInfo>

export const AudioMimeType = z.enum(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'])
export type AudioMimeType = z.infer<typeof AudioMimeType>

export const TranscribeRequest = z.strictObject({
  requestId: z.uuid(),
  mimeType: AudioMimeType,
  bytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 0 && b.byteLength <= MAX_AUDIO_BYTES, 'Audio too large'),
  durationMs: z.number().int().min(0).max(120_000),
})
export type TranscribeRequest = z.infer<typeof TranscribeRequest>

export const VoiceErrorCode = z.enum([
  'MIC_DENIED',
  'MIC_UNAVAILABLE',
  'MIC_BUSY',
  'NO_SPEECH',
  'NOT_CONFIGURED',
  'INVALID_API_KEY',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'TIMEOUT',
  'UNSUPPORTED',
  'BAD_REQUEST',
  'PROVIDER_ERROR',
  'BUSY',
  'CANCELED',
])
export type VoiceErrorCode = z.infer<typeof VoiceErrorCode>

export const VoiceError = z.object({
  code: VoiceErrorCode,
  message: z.string().max(500),
  retryable: z.boolean(),
})
export type VoiceError = z.infer<typeof VoiceError>

export const TranscribeOutcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), text: z.string().max(10_000) }),
  z.object({ status: z.literal('failed'), error: VoiceError }),
])
export type TranscribeOutcome = z.infer<typeof TranscribeOutcome>

/** Main → renderer while a transcription streams. */
export const VoiceEvent = z.object({
  type: z.literal('partial'),
  requestId: z.uuid(),
  /** The transcript so far, not just the newest piece. */
  text: z.string().max(10_000),
})
export type VoiceEvent = z.infer<typeof VoiceEvent>

export const SpeakRequest = z.strictObject({ text: z.string().trim().min(1).max(4096) })

export const SpeechAudioType = z.enum([
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'audio/opus',
])

export const SpeakOutcome = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    mimeType: SpeechAudioType,
    bytes: z.instanceof(Uint8Array),
  }),
  z.object({ status: z.literal('failed'), error: VoiceError }),
])
export type SpeakOutcome = z.infer<typeof SpeakOutcome>
