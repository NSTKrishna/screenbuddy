import { BrowserWindow, nativeImage } from 'electron'
import type { ScreenPermissionStatus } from '@shared/schemas/capture'
import type { CaptureBackend, CaptureDisplay } from '../services/capture/types'
import type { Size } from '../windows/geometry'

/**
 * E2E stand-in for desktopCapturer and TCC (D-018), so tests need no Screen
 * Recording grant and never see the real screen.
 */
export interface FakeCaptureState {
  displays: CaptureDisplay[]
  permission: ScreenPermissionStatus
  delayMs: number
  /** Every thumbnail size requested, in order. */
  requests: Size[]
  /** The assistant window's opacity at the moment each capture ran. */
  opacities: number[]
  openedUrls: string[]
}

export const DEFAULT_FAKE_DISPLAY: CaptureDisplay = {
  id: 1,
  label: 'Built-in Retina Display',
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2,
  isPrimary: true,
}

// One colour per display, so a test could tell captures apart.
const COLOURS: [number, number, number][] = [
  [40, 90, 200],
  [200, 80, 60],
  [60, 160, 90],
]

function solidImage(size: Size, [r, g, b]: [number, number, number]): Electron.NativeImage {
  // createFromBitmap expects BGRA.
  const buffer = Buffer.alloc(size.width * size.height * 4)
  buffer.fill(Buffer.from([b, g, r, 255]))
  return nativeImage.createFromBitmap(buffer, size)
}

/** Like desktopCapturer: scale each screen to fit the requested size, keeping its aspect. */
function fitTo(display: CaptureDisplay, box: Size): Size {
  const w = display.bounds.width * display.scaleFactor
  const h = display.bounds.height * display.scaleFactor
  const scale = Math.min(box.width / w, box.height / h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

export function createFakeCapture(): {
  state: FakeCaptureState
  backend: CaptureBackend
  screenStatus: () => ScreenPermissionStatus
  openExternal: (url: string) => Promise<void>
} {
  const state: FakeCaptureState = {
    displays: [DEFAULT_FAKE_DISPLAY],
    permission: 'granted',
    delayMs: 0,
    requests: [],
    opacities: [],
    openedUrls: [],
  }

  const backend: CaptureBackend = {
    displays: () => state.displays,
    cursorPoint: () => {
      const first = state.displays[0]
      return first === undefined ? { x: 0, y: 0 } : { x: first.bounds.x + 5, y: first.bounds.y + 5 }
    },
    screenSources: async (thumbnailSize) => {
      state.requests.push(thumbnailSize)
      state.opacities.push(BrowserWindow.getAllWindows()[0]?.getOpacity() ?? -1)
      if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs))
      return state.displays.map((d, i) => ({
        displayId: String(d.id),
        image: solidImage(fitTo(d, thumbnailSize), COLOURS[i % COLOURS.length] ?? [0, 0, 0]),
      }))
    },
    decodeImage: (bytes) => {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes))
      return image.isEmpty() ? null : image
    },
  }

  return {
    state,
    backend,
    screenStatus: () => state.permission,
    openExternal: (url) => {
      state.openedUrls.push(url)
      return Promise.resolve()
    },
  }
}
