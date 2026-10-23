import type { ScreenPermissionInfo, ScreenPermissionStatus } from '@shared/schemas/capture'
import type { MicPermissionInfo, MicPermissionStatus } from '@shared/schemas/voice'

/** Privacy & Security → Screen & System Audio Recording. A fixed URL, never caller-supplied. */
export const SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/** Privacy & Security → Microphone. */
export const MICROPHONE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

export interface PermissionDeps {
  platform: NodeJS.Platform
  /** `systemPreferences.getMediaAccessStatus('screen')` on macOS. */
  screenStatus: () => ScreenPermissionStatus
  /** `systemPreferences.getMediaAccessStatus('microphone')` on macOS. */
  micStatus: () => MicPermissionStatus
  /** `systemPreferences.askForMediaAccess('microphone')`: shows the macOS prompt once. */
  askForMic: () => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** The app name macOS shows in its Privacy list. */
  grantee: string
}

/**
 * Reports TCC status and links to System Settings (ARCHITECTURE.md §6.7).
 * macOS has no API that asks for Screen Recording: the first capture attempt
 * adds the app to the list, and a grant takes effect after a relaunch.
 */
export class PermissionService {
  constructor(private readonly deps: PermissionDeps) {}

  screenStatus(): ScreenPermissionStatus {
    if (this.deps.platform !== 'darwin') return 'granted'
    try {
      return this.deps.screenStatus()
    } catch {
      return 'unknown'
    }
  }

  screenInfo(): ScreenPermissionInfo {
    return {
      status: this.screenStatus(),
      grantee: this.deps.grantee,
      canOpenSettings: this.deps.platform === 'darwin',
    }
  }

  micStatus(): MicPermissionStatus {
    if (this.deps.platform !== 'darwin') return 'granted'
    try {
      return this.deps.micStatus()
    } catch {
      return 'unknown'
    }
  }

  micInfo(status: MicPermissionStatus = this.micStatus()): MicPermissionInfo {
    return { status, grantee: this.deps.grantee, canOpenSettings: this.deps.platform === 'darwin' }
  }

  /**
   * Asks for the microphone on an explicit user action. macOS prompts only
   * while the status is `not-determined`; after a refusal the user must
   * change it in System Settings.
   */
  async requestMic(): Promise<MicPermissionStatus> {
    const before = this.micStatus()
    if (before !== 'not-determined') return before
    try {
      await this.deps.askForMic()
    } catch {
      // Treat a failed prompt like a refusal; the status below says what happened.
    }
    return this.micStatus()
  }

  async openMicrophoneSettings(): Promise<void> {
    if (this.deps.platform !== 'darwin') return
    await this.deps.openExternal(MICROPHONE_SETTINGS_URL)
  }

  async openScreenRecordingSettings(): Promise<void> {
    if (this.deps.platform !== 'darwin') return
    await this.deps.openExternal(SCREEN_RECORDING_SETTINGS_URL)
  }
}
