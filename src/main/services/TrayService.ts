import { Menu, Tray, nativeImage } from 'electron'

export interface TrayActions {
  toggle: () => void
  newChat: () => void
  openSettings: () => void
  quit: () => void
}

export interface TrayState {
  visible: boolean
  accelerator: string
  shortcutRegistered: boolean
}

/** The menu-bar icon and its menu. */
export class TrayService {
  private readonly tray: Tray
  private menu: Menu | null = null

  constructor(
    iconPath: string,
    private readonly actions: TrayActions,
  ) {
    const image = nativeImage.createFromPath(iconPath)
    image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('ScreenBuddy')
  }

  refresh(state: TrayState): void {
    if (this.tray.isDestroyed()) return
    const menu = Menu.buildFromTemplate([
      {
        label: state.visible ? 'Hide ScreenBuddy' : 'Show ScreenBuddy',
        ...(state.shortcutRegistered
          ? { accelerator: state.accelerator, registerAccelerator: false }
          : {}),
        click: () => this.actions.toggle(),
      },
      { label: 'New Chat', click: () => this.actions.newChat() },
      { label: 'Settings…', click: () => this.actions.openSettings() },
      { type: 'separator' },
      {
        label: 'Quit ScreenBuddy',
        accelerator: 'CommandOrControl+Q',
        registerAccelerator: false,
        click: () => this.actions.quit(),
      },
    ])
    this.menu = menu
    this.tray.setContextMenu(menu)
  }

  /** For E2E: the current menu, since the real menu bar cannot be clicked. */
  menuForTests(): Menu | null {
    return this.menu
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }
}
