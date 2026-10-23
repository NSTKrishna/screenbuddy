import { z } from 'zod'
import { ScreenPermissionInfo } from '../schemas/capture'
import { ChatEvent } from '../schemas/chat'
import { VoiceEvent } from '../schemas/voice'
import { AssistantMode, ShortcutStatus } from './contract'

/** Every main → renderer event, validated in main before it is sent. */
export const ipcEvents = {
  'assistant:visibility': z.object({
    visible: z.boolean(),
    mode: AssistantMode,
    /** True when the user summoned the assistant and expects to type. */
    focusInput: z.boolean(),
  }),
  'assistant:command': z.object({ command: z.enum(['newChat', 'openSettings', 'toggleVoice']) }),
  'shortcut:status': ShortcutStatus,
  /** Sent when the window regains focus and the Screen Recording status has changed. */
  'permissions:screenChanged': ScreenPermissionInfo,
  /** Streaming progress for a chat turn, sent only to the assistant window. */
  'chat:event': ChatEvent,
  /** Live partial transcripts, when the transcription provider streams them. */
  'voice:event': VoiceEvent,
  'voiceShortcut:status': ShortcutStatus,
  'annotations:state': z.object({ visible: z.boolean() }),
} as const satisfies Record<string, z.ZodType>

export type IpcEvents = typeof ipcEvents
export type EventName = keyof IpcEvents
export type EventPayload<E extends EventName> = z.output<IpcEvents[E]>
