import type { AppInfo, AssistantMode } from './ipc/contract'
import type {
  CaptureOutcome,
  CaptureRequest,
  DisplayInfo,
  ImportImageRequest,
  ScreenPermissionInfo,
} from './schemas/capture'
import type { EventPayload } from './ipc/events'
import type {
  ChatAccepted,
  ChatHistory,
  ChatRetryRequest,
  ChatSendRequest,
  ConnectionTestResult,
} from './schemas/chat'
import type { PublicSettings, SettingsPatch } from './schemas/settings'
import type {
  MicPermissionInfo,
  SpeakOutcome,
  TranscribeOutcome,
  TranscribeRequest,
} from './schemas/voice'

type Unsubscribe = () => void

/** The complete API the assistant preload exposes as `window.screenBuddy`. */
export interface ScreenBuddyApi {
  app: {
    getInfo(): Promise<AppInfo>
    quit(): Promise<void>
    relaunch(): Promise<void>
  }
  settings: {
    get(): Promise<PublicSettings>
    update(patch: SettingsPatch): Promise<PublicSettings>
  }
  window: {
    setMode(mode: AssistantMode): Promise<void>
    hide(): Promise<void>
    resetPosition(): Promise<void>
    dragStart(): Promise<void>
    dragMove(): Promise<void>
    dragEnd(): Promise<void>
  }
  capture: {
    listDisplays(): Promise<DisplayInfo[]>
    take(request: CaptureRequest): Promise<CaptureOutcome>
    cancel(): Promise<void>
    importImage(request: ImportImageRequest): Promise<CaptureOutcome>
    discard(captureId: string): Promise<void>
  }
  secrets: {
    setApiKey(apiKey: string): Promise<PublicSettings>
    clearApiKey(): Promise<PublicSettings>
  }
  ai: {
    testConnection(): Promise<ConnectionTestResult>
  }
  chat: {
    send(request: ChatSendRequest): Promise<ChatAccepted>
    retry(request: ChatRetryRequest): Promise<ChatAccepted>
    cancel(turnId: string): Promise<void>
    reset(): Promise<void>
    history(): Promise<ChatHistory>
  }
  annotations: {
    demo(): Promise<{ shown: number }>
    clear(): Promise<void>
  }
  permissions: {
    getScreen(): Promise<ScreenPermissionInfo>
    openScreenSettings(): Promise<void>
    getMicrophone(): Promise<MicPermissionInfo>
    openMicrophoneSettings(): Promise<void>
  }
  voice: {
    begin(): Promise<MicPermissionInfo>
    end(): Promise<void>
    transcribe(request: TranscribeRequest): Promise<TranscribeOutcome>
    cancelTranscription(requestId: string): Promise<void>
    speak(text: string): Promise<SpeakOutcome>
  }
  events: {
    onVisibility(cb: (payload: EventPayload<'assistant:visibility'>) => void): Unsubscribe
    onCommand(cb: (payload: EventPayload<'assistant:command'>) => void): Unsubscribe
    onShortcutStatus(cb: (payload: EventPayload<'shortcut:status'>) => void): Unsubscribe
    onChatEvent(cb: (payload: EventPayload<'chat:event'>) => void): Unsubscribe
    onVoiceEvent(cb: (payload: EventPayload<'voice:event'>) => void): Unsubscribe
    onAnnotationState(cb: (payload: EventPayload<'annotations:state'>) => void): Unsubscribe
    onVoiceShortcutStatus(cb: (payload: EventPayload<'voiceShortcut:status'>) => void): Unsubscribe
    onScreenPermission(
      cb: (payload: EventPayload<'permissions:screenChanged'>) => void,
    ): Unsubscribe
  }
}

/** The keys `window.screenBuddy` exposes. E2E asserts on this list. */
export const BRIDGE_KEYS = [
  'ai',
  'annotations',
  'app',
  'capture',
  'chat',
  'events',
  'permissions',
  'secrets',
  'settings',
  'voice',
  'window',
] as const
