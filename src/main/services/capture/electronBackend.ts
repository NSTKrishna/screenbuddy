import { desktopCapturer, nativeImage, screen } from 'electron'
import type { CaptureBackend } from './types'

/** The real backend: Electron's `desktopCapturer` (D-004). */
export function electronCaptureBackend(): CaptureBackend {
  return {
    displays: () => {
      const primaryId = screen.getPrimaryDisplay().id
      return screen.getAllDisplays().map((d) => ({
        id: d.id,
        label: d.label,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === primaryId,
      }))
    },
    cursorPoint: () => screen.getCursorScreenPoint(),
    screenSources: async (thumbnailSize) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
        fetchWindowIcons: false,
      })
      return sources.map((s) => ({ displayId: s.display_id, image: s.thumbnail }))
    },
    decodeImage: (bytes) => {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes))
      return image.isEmpty() ? null : image
    },
  }
}
