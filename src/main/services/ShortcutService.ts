import type { ShortcutStatus } from '@shared/ipc/contract'

/** The slice of Electron's `globalShortcut` this service uses; tests pass a fake. */
export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * Owns the one global "toggle assistant" shortcut. Registration can fail
 * (another app holds the combination, or the accelerator is malformed), and
 * that is reported through `onStatus` rather than thrown.
 */
export class ShortcutService {
  private current: ShortcutStatus

  constructor(
    private readonly globalShortcut: GlobalShortcutLike,
    private readonly onTrigger: () => void,
    private readonly onStatus: (status: ShortcutStatus) => void = () => undefined,
  ) {
    this.current = { accelerator: '', registered: false }
  }

  register(accelerator: string): ShortcutStatus {
    this.unregister()
    let registered: boolean
    try {
      registered = this.globalShortcut.register(accelerator, this.onTrigger)
    } catch {
      // Electron throws for accelerators it cannot parse.
      registered = false
    }
    this.current = { accelerator, registered }
    this.onStatus(this.current)
    return this.current
  }

  unregister(): void {
    if (this.current.registered) {
      this.globalShortcut.unregister(this.current.accelerator)
      this.current = { ...this.current, registered: false }
    }
  }

  status(): ShortcutStatus {
    return this.current
  }
}
