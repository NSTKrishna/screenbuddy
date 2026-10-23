import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { OverlayPayload } from '@shared/schemas/annotations'

// The overlay only listens: it has no way to call main at all (SECURITY.md §4.3).
contextBridge.exposeInMainWorld('screenBuddyOverlay', {
  onShow: (cb: (payload: OverlayPayload) => void) => {
    ipcRenderer.on('overlay:show', (_e: IpcRendererEvent, payload: OverlayPayload) => cb(payload))
  },
  onClear: (cb: () => void) => {
    ipcRenderer.on('overlay:clear', () => cb())
  },
})
