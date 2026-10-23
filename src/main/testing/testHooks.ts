import type { ScreenPermissionStatus } from '@shared/schemas/capture'
import type { AiService, AiTimeouts } from '../services/ai/AiService'
import type { AnnotationService } from '../services/annotations/AnnotationService'
import type { CaptureStore } from '../services/capture/CaptureStore'
import type { CaptureDisplay } from '../services/capture/types'
import type { ShortcutService } from '../services/ShortcutService'
import type { TrayService } from '../services/TrayService'
import type { AssistantWindow } from '../windows/assistantWindow'
import type { FakeCaptureState } from './fakeCapture'
import type { FakeVoiceState } from './fakeVoice'
import type { MicrophoneGate } from '../security/microphoneGate'
import type { MicPermissionStatus } from '@shared/schemas/voice'

/**
 * Hooks Playwright drives through `electronApp.evaluate` (D-018). Installed
 * only when SCREENBUDDY_E2E=1 in an unpackaged build.
 */
export interface TestHooks {
  toggle: () => void
  state: () => ReturnType<AssistantWindow['debugState']>
  shortcut: () => ReturnType<ShortcutService['status']>
  /** Pretends the OS cursor is at this screen point. */
  setCursor: (x: number, y: number) => void
  trayLabels: () => string[]
  clickTray: (label: string) => void
  setDisplays: (displays: CaptureDisplay[]) => void
  setScreenPermission: (status: ScreenPermissionStatus) => void
  setCaptureDelay: (ms: number) => void
  captureLog: () => Pick<FakeCaptureState, 'requests' | 'opacities' | 'openedUrls'>
  /** How many full-size images main is holding. */
  storedCaptures: () => number
  windowOpacity: () => number
  setAiTiming: (timeouts: AiTimeouts, backoffBaseMs: number) => void
  setMicPermission: (status: MicPermissionStatus, promptAnswer?: boolean) => void
  voiceLog: () => { sttRequests: number; prompts: number; micArmed: boolean; micArms: number }
  /** The overlay window's state, for annotation assertions. */
  overlay: () => {
    exists: boolean
    visible: boolean
    ignoresMouse: boolean
    alwaysOnTop: boolean
    focusable: boolean
    bounds: Electron.Rectangle | null
  }
}

declare global {
  var __screenBuddyTest: TestHooks | undefined
}

export function installTestHooks(deps: {
  assistant: AssistantWindow
  shortcuts: ShortcutService
  tray: TrayService
  captures: CaptureStore
  fakeCapture: FakeCaptureState | null
  ai: AiService
  fakeVoice: FakeVoiceState | null
  microphone: MicrophoneGate
  annotations: AnnotationService
}): void {
  const voice = (): FakeVoiceState => {
    if (deps.fakeVoice === null) throw new Error('fake voice not installed')
    return deps.fakeVoice
  }

  const fake = (): FakeCaptureState => {
    if (deps.fakeCapture === null) throw new Error('fake capture not installed')
    return deps.fakeCapture
  }

  let cursor = { x: 0, y: 0 }
  deps.assistant.overrideCursorForTests(() => cursor)

  const items = (): Electron.MenuItem[] => deps.tray.menuForTests()?.items ?? []

  globalThis.__screenBuddyTest = {
    toggle: () => deps.assistant.toggle(),
    state: () => deps.assistant.debugState(),
    shortcut: () => deps.shortcuts.status(),
    setCursor: (x, y) => {
      cursor = { x, y }
    },
    trayLabels: () => items().map((item) => item.label),
    clickTray: (label) => {
      const item = items().find((i) => i.label === label)
      if (item === undefined) throw new Error(`No tray item "${label}"`)
      // Electron types MenuItem.click as a bare `Function`; ours take no arguments.
      ;(item.click as () => void)()
    },
    setDisplays: (displays) => {
      fake().displays = displays
    },
    setScreenPermission: (status) => {
      fake().permission = status
    },
    setCaptureDelay: (ms) => {
      fake().delayMs = ms
    },
    captureLog: () => {
      const { requests, opacities, openedUrls } = fake()
      return { requests, opacities, openedUrls }
    },
    storedCaptures: () => deps.captures.size,
    windowOpacity: () => deps.assistant.debugOpacity(),
    setAiTiming: (timeouts, backoffBaseMs) => deps.ai.setTimingForTests(timeouts, backoffBaseMs),
    setMicPermission: (status, promptAnswer = true) => {
      voice().micStatus = status
      voice().promptAnswer = promptAnswer
    },
    overlay: () => {
      const w = deps.annotations.debugWindow()
      const alive = w !== null && !w.isDestroyed()
      return {
        exists: alive,
        visible: alive && w.isVisible(),
        // setIgnoreMouseEvents has no getter; the service always sets it on creation.
        ignoresMouse: alive,
        alwaysOnTop: alive && w.isAlwaysOnTop(),
        focusable: alive && w.isFocusable(),
        bounds: alive ? w.getBounds() : null,
      }
    },
    voiceLog: () => ({
      sttRequests: voice().sttRequests,
      prompts: voice().prompts,
      micArmed: deps.microphone.isArmed(),
      micArms: deps.microphone.armCount(),
    }),
  }
}
