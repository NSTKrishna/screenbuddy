import { BrowserWindow, screen, type Display, type WebContents } from 'electron'
import type { AssistantMode } from '@shared/ipc/contract'
import { ipcEvents, type EventName, type EventPayload } from '@shared/ipc/events'
import { hardenedWebPreferences } from '../security/webPreferences'
import type { RendererLocation } from '../security/rendererOrigin'
import type { SettingsStore } from '../services/storage/SettingsStore'
import {
  anchorOf,
  clampRect,
  defaultAnchor,
  displayForAnchor,
  placeWindow,
  resolveInitialAnchor,
  type DisplayLike,
  type Point,
} from './geometry'

export interface AssistantWindowDeps {
  preloadPath: string
  location: RendererLocation
  settings: SettingsStore
  isQuitting: () => boolean
  onVisibilityChange: (visible: boolean) => void
  /** Called when the window gains focus, for example to re-check permissions. */
  onFocus?: () => void
  log: (message: string) => void
}

export interface ShowOptions {
  mode?: AssistantMode
  focusInput: boolean
}

/** Roughly two frames: enough for the renderer to paint after a show. */
const REVEAL_DELAY_MS = 34
/** Time for the WindowServer to drop the assistant from the screen before a capture. */
const CONCEAL_SETTLE_MS = 120

function toDisplayLike(d: Display): DisplayLike {
  return { id: d.id, workArea: d.workArea }
}

/**
 * The floating assistant: a frameless, transparent, always-on-top panel.
 *
 * Its position is tracked as an anchor, the window's bottom-right corner,
 * so the orb stays put while the panel grows up and to the left from it.
 */
export class AssistantWindow {
  private readonly win: BrowserWindow
  private mode: AssistantMode = 'collapsed'
  private anchor: Point
  private dragOffset: Point | null = null
  private revealTimer: NodeJS.Timeout | null = null
  private cursor: () => Point = () => screen.getCursorScreenPoint()

  constructor(private readonly deps: AssistantWindowDeps) {
    const saved = deps.settings.get().windowAnchor
    this.anchor = resolveInitialAnchor(saved, this.displays(), this.primary())
    const { rect } = this.placement(this.mode)

    this.win = new BrowserWindow({
      ...rect,
      show: false,
      title: 'ScreenBuddy',
      type: 'panel',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      webPreferences: hardenedWebPreferences(deps.preloadPath),
    })

    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
    // Keeps the assistant out of screenshots (ARCHITECTURE.md §6.1).
    this.win.setContentProtection(true)

    this.win.on('close', (event) => {
      if (!this.deps.isQuitting()) {
        event.preventDefault()
        this.hide()
      }
    })
    // Fires once a native drag (the panel header) finishes.
    this.win.on('focus', () => this.deps.onFocus?.())
    this.win.on('moved', () => {
      if (this.dragOffset === null) this.commitAnchor(anchorOf(this.win.getBounds()))
    })

    const display = (): void => this.reposition()
    screen.on('display-added', display)
    screen.on('display-removed', display)
    screen.on('display-metrics-changed', display)
    this.win.once('closed', () => {
      screen.off('display-added', display)
      screen.off('display-removed', display)
      screen.off('display-metrics-changed', display)
    })
  }

  async load(): Promise<void> {
    const { location } = this.deps
    if (location.kind === 'url') await this.win.loadURL(location.target)
    else await this.win.loadFile(location.target)
  }

  get contents(): WebContents {
    return this.win.webContents
  }

  ownsContents(contents: WebContents): boolean {
    return !this.win.isDestroyed() && contents.id === this.win.webContents.id
  }

  isVisible(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible()
  }

  getMode(): AssistantMode {
    return this.mode
  }

  show({ mode, focusInput }: ShowOptions): void {
    if (this.win.isDestroyed()) return
    if (mode !== undefined) this.mode = mode
    this.applyPlacement()
    const wasVisible = this.win.isVisible()
    // A hidden window still holds its last frame. Keep it transparent until
    // the renderer has drawn the new state, so the old frame never flashes.
    if (!wasVisible) this.win.setOpacity(0)
    if (focusInput) {
      this.win.show()
      this.win.focus()
    } else {
      this.win.showInactive()
    }
    this.send('assistant:visibility', { visible: true, mode: this.mode, focusInput })
    if (!wasVisible) {
      if (this.revealTimer !== null) clearTimeout(this.revealTimer)
      this.revealTimer = setTimeout(() => {
        this.revealTimer = null
        if (!this.win.isDestroyed()) this.win.setOpacity(1)
      }, REVEAL_DELAY_MS)
    }
    this.deps.onVisibilityChange(true)
  }

  hide(): void {
    if (this.win.isDestroyed() || !this.win.isVisible()) return
    this.dragOffset = null
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    this.win.hide()
    this.send('assistant:visibility', { visible: false, mode: this.mode, focusInput: false })
    this.deps.onVisibilityChange(false)
  }

  /**
   * The global shortcut. Hidden → open the chat. Showing only the orb → open
   * the chat (the user pressed it to type). Chat open → hide.
   */
  toggle(): void {
    if (this.isVisible() && this.mode === 'expanded') this.hide()
    else this.show({ mode: 'expanded', focusInput: true })
  }

  setMode(mode: AssistantMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.applyPlacement()
  }

  resetPosition(): void {
    this.commitAnchor(defaultAnchor(this.primary()))
    this.applyPlacement()
  }

  dragStart(): void {
    const cursor = this.cursor()
    const bounds = this.win.getBounds()
    this.dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
  }

  dragMove(): void {
    if (this.dragOffset === null) return
    const cursor = this.cursor()
    this.win.setPosition(
      Math.round(cursor.x - this.dragOffset.x),
      Math.round(cursor.y - this.dragOffset.y),
    )
  }

  dragEnd(): void {
    if (this.dragOffset === null) return
    this.dragOffset = null
    const bounds = this.win.getBounds()
    const display = displayForAnchor(anchorOf(bounds), this.displays()) ?? this.primary()
    const clamped = clampRect(bounds, display.workArea)
    this.win.setBounds(clamped)
    this.commitAnchor(anchorOf(clamped))
  }

  send<E extends EventName>(event: E, payload: EventPayload<E>): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.send(event, ipcEvents[event].parse(payload))
  }

  /**
   * Makes the window fully transparent for the duration of a capture. Opacity
   * is used rather than hide() so focus, Space and renderer state survive.
   * Content protection is on as well, but newer macOS capture paths may
   * ignore it, so this step is the guarantee (ARCHITECTURE.md §6.1).
   */
  async concealForCapture(): Promise<() => void> {
    if (this.win.isDestroyed() || !this.win.isVisible()) return () => undefined
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    this.win.setOpacity(0)
    await new Promise((resolve) => setTimeout(resolve, CONCEAL_SETTLE_MS))
    return () => {
      if (!this.win.isDestroyed()) this.win.setOpacity(1)
    }
  }

  /** The display the window is on, or null while hidden. */
  activeDisplayId(): number | null {
    if (!this.isVisible()) return null
    return screen.getDisplayMatching(this.win.getBounds()).id
  }

  /** For E2E assertions only. */
  debugOpacity(): number {
    return this.win.getOpacity()
  }

  /** For E2E assertions only. */
  debugState(): { visible: boolean; mode: AssistantMode; bounds: Electron.Rectangle } {
    return { visible: this.isVisible(), mode: this.mode, bounds: this.win.getBounds() }
  }

  /** For E2E: Playwright cannot move the real cursor, so drags read this instead. */
  overrideCursorForTests(cursor: () => Point): void {
    this.cursor = cursor
  }

  waitUntilReady(): Promise<void> {
    return new Promise((resolve) => {
      this.win.once('ready-to-show', () => resolve())
    })
  }

  destroy(): void {
    if (!this.win.isDestroyed()) this.win.destroy()
  }

  private displays(): DisplayLike[] {
    return screen.getAllDisplays().map(toDisplayLike)
  }

  private primary(): DisplayLike {
    return toDisplayLike(screen.getPrimaryDisplay())
  }

  private placement(mode: AssistantMode): ReturnType<typeof placeWindow> {
    return placeWindow(this.anchor, mode, this.displays(), this.primary())
  }

  /** Sizes the window for the current mode and keeps it on screen. */
  private applyPlacement(): void {
    const { rect } = this.placement(this.mode)
    this.win.setBounds(rect)
    this.commitAnchor(anchorOf(rect))
  }

  /** Re-places the window after a display is added, removed or rescaled. */
  private reposition(): void {
    if (this.win.isDestroyed()) return
    const displays = this.displays()
    this.anchor = resolveInitialAnchor(this.anchor, displays, this.primary())
    this.applyPlacement()
  }

  private commitAnchor(anchor: Point): void {
    const unchanged = anchor.x === this.anchor.x && anchor.y === this.anchor.y
    this.anchor = anchor
    const display = displayForAnchor(anchor, this.displays()) ?? this.primary()
    const saved = this.deps.settings.get().windowAnchor
    if (unchanged && saved !== null && saved.x === anchor.x && saved.y === anchor.y) return
    this.deps.settings.setWindowAnchor({ x: anchor.x, y: anchor.y, displayId: display.id })
  }
}
