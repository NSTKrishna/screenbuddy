import { z } from 'zod'
import { checkBaseUrl } from '../baseUrl'
import { VoiceSettings } from './voice'

export const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+Space'

export const SETTINGS_SCHEMA_VERSION = 1

/** Where the assistant sits: the bottom-right corner of its window, in screen DIPs. */
export const WindowAnchor = z.object({
  x: z.number(),
  y: z.number(),
  displayId: z.number().int(),
})
export type WindowAnchor = z.infer<typeof WindowAnchor>

export const AiProviderKind = z.enum(['mock', 'openai-compatible'])
export type AiProviderKind = z.infer<typeof AiProviderKind>

const BaseUrl = z
  .string()
  .max(500)
  .refine((v) => checkBaseUrl(v).ok, 'Invalid base URL')
  .transform((v) => {
    const checked = checkBaseUrl(v)
    return checked.ok ? checked.url : v
  })

const ModelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\s]+$/, 'Model IDs have no spaces')

/** Which model to talk to. The API key is not here: it lives in SecretStore. */
export const AiConfig = z.object({
  provider: AiProviderKind.default('mock'),
  baseUrl: BaseUrl.default('https://api.openai.com/v1'),
  model: ModelId.default('gpt-4o-mini'),
  /** Whether screenshots may be sent. Off for text-only models. */
  supportsVision: z.boolean().default(true),
})
export type AiConfig = z.infer<typeof AiConfig>

/** Everything persisted in settings.json. Lives in main only. */
export const Settings = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  shortcut: z.string().min(1).max(64).default(DEFAULT_SHORTCUT),
  showDockIcon: z.boolean().default(false),
  /**
   * Capture the screen when a message clearly asks about it. The screenshot
   * is only attached for review; nothing is sent until the user confirms.
   */
  autoCaptureScreenQuestions: z.boolean().default(true),
  windowAnchor: WindowAnchor.nullable().default(null),
  ai: AiConfig.prefault({}),
  /** Opt-in: keep the current conversation's *text* on disk between launches. */
  saveHistory: z.boolean().default(false),
  voice: VoiceSettings.prefault({}),
  /** How long on-screen annotations stay before fading. */
  annotationSeconds: z.number().int().min(2).max(60).default(8),
})
export type Settings = z.infer<typeof Settings>

/** What a renderer may know about the API key: never the key itself. */
export const ApiKeyStatus = z.object({
  present: z.boolean(),
  /** "••••abcd", computed in main. */
  hint: z.string().max(16).nullable(),
  /** keychain: encrypted on disk; memory: this session only; env: SCREENBUDDY_API_KEY. */
  storage: z.enum(['keychain', 'memory', 'env', 'none']),
})
export type ApiKeyStatus = z.infer<typeof ApiKeyStatus>

/** The stored settings a renderer may see. */
export const VisibleSettings = Settings.pick({
  shortcut: true,
  showDockIcon: true,
  autoCaptureScreenQuestions: true,
  ai: true,
  saveHistory: true,
  voice: true,
  annotationSeconds: true,
})
export type VisibleSettings = z.infer<typeof VisibleSettings>

/** Everything the renderer gets: visible settings plus the API key's status. */
export const PublicSettings = VisibleSettings.extend({ apiKey: ApiKeyStatus })
export type PublicSettings = z.infer<typeof PublicSettings>

/** What a renderer may change. Every field is optional; unknown keys are rejected. */
export const SettingsPatch = z.strictObject({
  showDockIcon: z.boolean().optional(),
  autoCaptureScreenQuestions: z.boolean().optional(),
  saveHistory: z.boolean().optional(),
  annotationSeconds: z.number().int().min(2).max(60).optional(),
  ai: z
    .strictObject({
      provider: AiProviderKind.optional(),
      baseUrl: BaseUrl.optional(),
      model: ModelId.optional(),
      supportsVision: z.boolean().optional(),
    })
    .optional(),
  /** Any subset of the voice settings; nested groups are merged, not replaced. */
  voice: z
    .strictObject({
      mode: VoiceSettings.shape.mode.unwrap().optional(),
      speakResponses: z.boolean().optional(),
      autoSend: z.boolean().optional(),
      volume: z.number().min(0).max(1).optional(),
      rate: z.number().min(0.5).max(2).optional(),
      shortcutEnabled: z.boolean().optional(),
      transcription: VoiceSettings.shape.transcription.unwrap().partial().strict().optional(),
      speech: VoiceSettings.shape.speech.unwrap().partial().strict().optional(),
    })
    .optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatch>

export function defaultSettings(): Settings {
  return Settings.parse({ schemaVersion: SETTINGS_SCHEMA_VERSION })
}
