import { z } from 'zod'
import {
  CaptureOutcome,
  CaptureRequest,
  DisplayInfo,
  ImportImageRequest,
  ScreenPermissionInfo,
} from '../schemas/capture'
import {
  ChatAccepted,
  ChatHistory,
  ChatRetryRequest,
  ChatSendRequest,
  ConnectionTestResult,
  SetApiKeyRequest,
} from '../schemas/chat'
import { PublicSettings, SettingsPatch } from '../schemas/settings'
import {
  MicPermissionInfo,
  SpeakOutcome,
  SpeakRequest,
  TranscribeOutcome,
  TranscribeRequest,
} from '../schemas/voice'

export const AssistantMode = z.enum(['collapsed', 'expanded'])
export type AssistantMode = z.infer<typeof AssistantMode>

export const ShortcutStatus = z.object({
  accelerator: z.string(),
  registered: z.boolean(),
})
export type ShortcutStatus = z.infer<typeof ShortcutStatus>

export const AppInfo = z.object({
  version: z.string(),
  platform: z.string(),
  shortcut: ShortcutStatus,
  mode: AssistantMode,
})
export type AppInfo = z.infer<typeof AppInfo>

const none = z.void()

/**
 * Every renderer → main channel. Main validates requests against `req` and,
 * in dev and test builds, responses against `res` (SECURITY.md §4).
 */
export const ipcContract = {
  'app:getInfo': { req: none, res: AppInfo },
  'app:quit': { req: none, res: none },
  /** Restarts the app; macOS applies a Screen Recording grant only after a relaunch. */
  'app:relaunch': { req: none, res: none },
  'settings:get': { req: none, res: PublicSettings },
  'settings:update': { req: SettingsPatch, res: PublicSettings },
  'window:setMode': { req: z.strictObject({ mode: AssistantMode }), res: none },
  'window:hide': { req: none, res: none },
  'window:resetPosition': { req: none, res: none },
  'window:dragStart': { req: none, res: none },
  'window:dragMove': { req: none, res: none },
  'window:dragEnd': { req: none, res: none },
  'capture:listDisplays': { req: none, res: z.array(DisplayInfo).max(32) },
  'capture:take': { req: CaptureRequest, res: CaptureOutcome },
  'capture:cancel': { req: none, res: none },
  'capture:importImage': { req: ImportImageRequest, res: CaptureOutcome },
  'capture:discard': { req: z.strictObject({ captureId: z.uuid() }), res: none },
  'permissions:getScreen': { req: none, res: ScreenPermissionInfo },
  'permissions:openScreenSettings': { req: none, res: none },
  /** Write-only: the key goes in, only its status ever comes out (SECURITY.md §5). */
  'secrets:setApiKey': { req: SetApiKeyRequest, res: PublicSettings },
  'secrets:clearApiKey': { req: none, res: PublicSettings },
  'ai:testConnection': { req: none, res: ConnectionTestResult },
  'chat:send': { req: ChatSendRequest, res: ChatAccepted },
  'chat:retry': { req: ChatRetryRequest, res: ChatAccepted },
  'chat:cancel': { req: z.strictObject({ turnId: z.uuid() }), res: none },
  'chat:reset': { req: none, res: none },
  'chat:history': { req: none, res: ChatHistory },
  'permissions:getMicrophone': { req: none, res: MicPermissionInfo },
  'permissions:openMicrophoneSettings': { req: none, res: none },
  /**
   * The user pressed the mic button. Asks macOS for access if needed and, if
   * granted, lets the page open the microphone until `voice:end` (or 70 s).
   */
  'voice:begin': { req: none, res: MicPermissionInfo },
  'voice:end': { req: none, res: none },
  'voice:transcribe': { req: TranscribeRequest, res: TranscribeOutcome },
  'voice:cancelTranscription': { req: z.strictObject({ requestId: z.uuid() }), res: none },
  /** Provider text-to-speech; the system voice runs in the renderer. */
  'voice:speak': { req: SpeakRequest, res: SpeakOutcome },
  /** Manual demo: draws a fixed set of shapes on the display ScreenBuddy is on. */
  'annotations:demo': { req: none, res: z.object({ shown: z.number().int() }) },
  'annotations:clear': { req: none, res: none },
} as const satisfies Record<string, { req: z.ZodType; res: z.ZodType }>

export type IpcContract = typeof ipcContract
export type Channel = keyof IpcContract
export type IpcRequest<C extends Channel> = z.input<IpcContract[C]['req']>
export type IpcResponse<C extends Channel> = z.output<IpcContract[C]['res']>

export const IpcErrorCode = z.enum(['FORBIDDEN', 'INVALID_REQUEST', 'INTERNAL'])
export type IpcErrorCode = z.infer<typeof IpcErrorCode>

/** Handlers never throw across the bridge; they return this envelope. */
export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode; message: string } }
