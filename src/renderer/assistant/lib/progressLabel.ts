import type { ChatProgress } from '../stores/useChatStore'

/** What the assistant is doing before the first word arrives. */
export function progressLabel(progress: ChatProgress | null): string {
  if (progress === null) return 'Thinking'
  switch (progress.stage) {
    case 'connecting':
      return 'Connecting'
    case 'waiting':
      return progress.withImage ? 'Looking at your screenshot' : 'Thinking'
    case 'retrying':
      return `Retrying (attempt ${progress.attempt} of ${progress.maxAttempts})`
  }
}
