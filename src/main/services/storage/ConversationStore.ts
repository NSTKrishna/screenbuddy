import { rmSync } from 'node:fs'
import { ChatHistory, type HistoryMessage } from '@shared/schemas/chat'
import { quarantine, readJsonSync, writeJsonAtomic } from './atomicJson'

/**
 * The current conversation's text, saved only when the user opts in
 * (`saveHistory`). It never contains images: each message records only
 * whether one was attached.
 */
export class ConversationStore {
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  load(): HistoryMessage[] {
    const result = readJsonSync(this.path)
    if (result.status !== 'ok') return []
    const parsed = ChatHistory.safeParse(result.value)
    if (!parsed.success) {
      this.log('history: saved conversation failed validation, ignoring it')
      quarantine(this.path)
      return []
    }
    return parsed.data.messages
  }

  save(messages: HistoryMessage[]): Promise<void> {
    const snapshot: ChatHistory = { messages: messages.slice(-500) }
    this.writing = this.writing
      .then(() => writeJsonAtomic(this.path, snapshot))
      .catch(() => {
        this.log('history: write failed')
      })
    return this.writing
  }

  async clear(): Promise<void> {
    await this.writing
    rmSync(this.path, { force: true })
  }
}
