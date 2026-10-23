import { BrowserWindow, screen } from 'electron'
import type { Annotation, OverlayPayload } from '@shared/schemas/annotations'
import { OverlayPayload as OverlayPayloadSchema } from '@shared/schemas/annotations'
import { hardenedWebPreferences } from '../../security/webPreferences'
import { toOverlayShapes } from './coordinates'

export interface AnnotationDeps {
  preloadPath: string
  /** Dev server URL or bundled file for the overlay page. */
  page: { kind: 'url' | 'file'; target: string }
  durationMs: () => number
  onChange: (visible: boolean) => void
}

/**
 * One transparent, click-through, always-on-top window over the target
 * display (D-010, simplified to a single window). It draws only; it can't
 * receive clicks or take focus, so the user keeps working underneath.
 */
export class AnnotationService {
  private win: BrowserWindow | null = null
  private loaded: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private visible = false

  constructor(private readonly deps: AnnotationDeps) {}

  /** Shows `items` (normalized to the screenshot) on `displayId`; returns how many were drawn. */
  async show(displayId: number | null, items: readonly Annotation[]): Promise<number> {
    const display =
      screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
    const shapes = toOverlayShapes(items, display.bounds)
    if (shapes.length === 0) return 0
    const win = this.window()
    await this.loaded
    win.setBounds(display.bounds)
    const payload: OverlayPayload = OverlayPayloadSchema.parse({
      shapes,
      durationMs: this.deps.durationMs(),
    })
    win.webContents.send('overlay:show', payload)
    win.showInactive()
    this.setVisible(true)
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.clear(), payload.durationMs)
    return shapes.length
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.win !== null && !this.win.isDestroyed()) {
      this.win.webContents.send('overlay:clear')
      this.win.hide()
    }
    this.setVisible(false)
  }

  isVisible(): boolean {
    return this.visible
  }

  destroy(): void {
    this.clear()
    if (this.win !== null && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    this.deps.onChange(visible)
  }

  private window(): BrowserWindow {
    if (this.win !== null && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      focusable: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      webPreferences: hardenedWebPreferences(this.deps.preloadPath),
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
    // Click-through: every mouse event goes to the apps underneath.
    win.setIgnoreMouseEvents(true)
    // Keep annotations out of ScreenBuddy's own screenshots.
    win.setContentProtection(true)
    const { page } = this.deps
    this.loaded = (page.kind === 'url' ? win.loadURL(page.target) : win.loadFile(page.target)).then(
      () => undefined,
    )
    this.win = win
    return win
  }

  /** For E2E only. */
  debugWindow(): BrowserWindow | null {
    return this.win
  }
}
