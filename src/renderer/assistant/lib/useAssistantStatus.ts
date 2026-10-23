import { useChatStore } from '../stores/useChatStore'
import { useVoiceStore } from '../stores/useVoiceStore'

/** Idle → Listening → Transcribing → Thinking → (Responding) → Speaking → Idle. */
export type AssistantStatus =
  'idle' | 'listening' | 'transcribing' | 'thinking' | 'responding' | 'speaking' | 'error'

/** One status for the orb and header, combining voice and chat. */
export function useAssistantStatus(): AssistantStatus {
  const phase = useVoiceStore((s) => s.phase)
  const chat = useChatStore((s) => s.status)
  if (phase === 'listening' || phase === 'requesting') return 'listening'
  if (phase === 'transcribing') return 'transcribing'
  if (chat !== 'idle') return chat
  if (phase === 'speaking') return 'speaking'
  return 'idle'
}
