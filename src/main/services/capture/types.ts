import type { Point, Rect, Size } from '../../windows/geometry'

/** The slice of Electron's `NativeImage` the capture pipeline uses; tests pass fakes. */
export interface CaptureImage {
  isEmpty: () => boolean
  getSize: () => Size
  resize: (options: {
    width: number
    height: number
    quality?: 'good' | 'better' | 'best'
  }) => CaptureImage
  toJPEG: (quality: number) => Buffer
}

export interface CaptureDisplay {
  id: number
  label: string
  /** DIP bounds in the global screen space. */
  bounds: Rect
  scaleFactor: number
  isPrimary: boolean
}

export interface CaptureSource {
  /** `desktopCapturer` reports this as a string; it matches `Display.id`. */
  displayId: string
  image: CaptureImage
}

/** Everything platform-specific the capture service needs. */
export interface CaptureBackend {
  displays: () => CaptureDisplay[]
  cursorPoint: () => Point
  /** One capture of every screen, each scaled to fit `thumbnailSize` (physical px). */
  screenSources: (thumbnailSize: Size) => Promise<CaptureSource[]>
  decodeImage: (bytes: Uint8Array) => CaptureImage | null
}

/** Keeps the assistant out of its own screenshots. */
export interface CaptureConcealer {
  /** Makes the assistant invisible; resolves once that has reached the screen. */
  conceal: () => Promise<() => void>
  /** The display the assistant is on, if it is showing. */
  activeDisplayId: () => number | null
}
