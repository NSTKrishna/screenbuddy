import { randomUUID } from 'node:crypto'
import type {
  CaptureFailureCode,
  CaptureOutcome,
  CaptureRequest,
  CaptureTarget,
  DisplayInfo,
  ImportImageRequest,
  ScreenPermissionStatus,
} from '@shared/schemas/capture'
import { containsPoint } from '../../windows/geometry'
import type { CaptureStore } from './CaptureStore'
import {
  encodeJpeg,
  MODEL_JPEG_QUALITY,
  MODEL_MAX_EDGE,
  physicalSize,
  PREVIEW_JPEG_QUALITY,
  PREVIEW_MAX_EDGE,
  sniffImageType,
} from './imageProcessing'
import type {
  CaptureBackend,
  CaptureConcealer,
  CaptureDisplay,
  CaptureImage,
  CaptureSource,
} from './types'

export interface ScreenCaptureDeps {
  backend: CaptureBackend
  screenPermission: () => ScreenPermissionStatus
  concealer: CaptureConcealer
  store: CaptureStore
  newId?: () => string
  now?: () => number
  log?: (message: string) => void
}

const MESSAGES: Record<CaptureFailureCode, string> = {
  PERMISSION_DENIED: "ScreenBuddy doesn't have permission to record your screen.",
  NO_DISPLAYS: 'No displays were found to capture.',
  DISPLAY_NOT_FOUND: 'That display is no longer connected.',
  CAPTURE_FAILED: "The screen couldn't be captured. Please try again.",
  CANCELED: 'Capture canceled.',
  BUSY: 'A capture is already in progress.',
  INVALID_IMAGE: "That file couldn't be read as an image.",
}

function failed(code: CaptureFailureCode, message: string = MESSAGES[code]): CaptureOutcome {
  return { status: 'failed', failure: { code, message } }
}

export function displayLabel(display: CaptureDisplay, index: number): string {
  const label = display.label.trim()
  return label === '' ? `Display ${index + 1}` : label.slice(0, 200)
}

/** Keeps a file name readable and harmless for display: no paths, no control characters. */
export function cleanFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (base === '') return 'Uploaded image'
  return base.length > 80 ? `${base.slice(0, 79)}…` : base
}

/**
 * Captures one display on explicit request (SECURITY.md §7). It has no
 * timers and never runs on its own: every capture starts from an IPC call
 * that a user action made.
 *
 * The full image stays in `CaptureStore` in main memory; callers get a small
 * preview plus an id.
 */
export class ScreenCaptureService {
  private inFlight: { canceled: boolean } | null = null
  private readonly newId: () => string
  private readonly now: () => number
  private readonly log: (message: string) => void

  constructor(private readonly deps: ScreenCaptureDeps) {
    this.newId = deps.newId ?? randomUUID
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => undefined)
  }

  listDisplays(): DisplayInfo[] {
    return this.deps.backend.displays().map((d, i) => {
      const pixels = physicalSize(d.bounds, d.scaleFactor)
      return {
        id: d.id,
        label: displayLabel(d, i),
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        pixelWidth: pixels.width,
        pixelHeight: pixels.height,
        isPrimary: d.isPrimary,
      }
    })
  }

  async capture(request: CaptureRequest): Promise<CaptureOutcome> {
    if (this.inFlight !== null) return failed('BUSY')

    const before = this.deps.screenPermission()
    if (before === 'denied' || before === 'restricted') {
      this.log('capture: screen permission not granted')
      return failed('PERMISSION_DENIED')
    }

    const displays = this.deps.backend.displays()
    if (displays.length === 0) return failed('NO_DISPLAYS')
    const index = this.resolveTarget(request.target, displays)
    const display = index === -1 ? undefined : displays[index]
    if (display === undefined) return failed('DISPLAY_NOT_FOUND')

    const token = { canceled: false }
    this.inFlight = token
    // cancel() flips this from another call, so read it fresh each time.
    const canceled = (): boolean => token.canceled
    let sources: CaptureSource[]
    let restore: (() => void) | null = null
    try {
      restore = await this.deps.concealer.conceal()
      if (canceled()) return failed('CANCELED')
      // Ask for the display's native pixels so Retina captures stay sharp.
      sources = await this.deps.backend.screenSources(
        physicalSize(display.bounds, display.scaleFactor),
      )
    } catch {
      this.log('capture: desktop capture failed')
      return this.notGrantedNow() ? failed('PERMISSION_DENIED') : failed('CAPTURE_FAILED')
    } finally {
      restore?.()
      this.inFlight = null
    }

    if (canceled()) return failed('CANCELED')

    const source = pickSource(sources, display, displays.length)
    // Without permission macOS still answers, but with an empty or wallpaper-only
    // image. The permission status after the attempt is the reliable signal.
    if (this.notGrantedNow()) return failed('PERMISSION_DENIED')
    if (source === undefined || source.image.isEmpty()) {
      this.log('capture: no image for the requested display')
      return failed('CAPTURE_FAILED')
    }

    return this.keep(source.image, {
      source: 'screen',
      label: displayLabel(display, index),
      displayId: display.id,
      scaleFactor: display.scaleFactor,
    })
  }

  /** Cancels the capture in progress, if any. Its image is dropped unseen. */
  cancel(): void {
    if (this.inFlight !== null) this.inFlight.canceled = true
  }

  importImage({ name, bytes }: ImportImageRequest): CaptureOutcome {
    if (sniffImageType(bytes) === null) {
      return failed('INVALID_IMAGE', 'Only PNG and JPEG images are supported.')
    }
    const image = this.deps.backend.decodeImage(bytes)
    if (image === null || image.isEmpty()) return failed('INVALID_IMAGE')
    return this.keep(image, {
      source: 'upload',
      label: cleanFileName(name),
      displayId: null,
      scaleFactor: 1,
    })
  }

  discard(captureId: string): void {
    this.deps.store.delete(captureId)
  }

  clearAll(): void {
    this.deps.store.clear()
  }

  private notGrantedNow(): boolean {
    return this.deps.screenPermission() !== 'granted'
  }

  private resolveTarget(target: CaptureTarget, displays: CaptureDisplay[]): number {
    if (target.kind === 'display') return displays.findIndex((d) => d.id === target.displayId)
    const active = this.deps.concealer.activeDisplayId()
    const byActive = displays.findIndex((d) => d.id === active)
    if (byActive !== -1) return byActive
    const cursor = this.deps.backend.cursorPoint()
    const byCursor = displays.findIndex((d) => containsPoint(d.bounds, cursor))
    if (byCursor !== -1) return byCursor
    const primary = displays.findIndex((d) => d.isPrimary)
    return primary === -1 ? 0 : primary
  }

  private keep(
    image: CaptureImage,
    meta: {
      source: 'screen' | 'upload'
      label: string
      displayId: number | null
      scaleFactor: number
    },
  ): CaptureOutcome {
    const model = encodeJpeg(image, MODEL_MAX_EDGE, MODEL_JPEG_QUALITY)
    const preview = encodeJpeg(image, PREVIEW_MAX_EDGE, PREVIEW_JPEG_QUALITY)
    const captureId = this.newId()
    const capturedAt = this.now()
    this.deps.store.put({
      id: captureId,
      jpeg: model.jpeg,
      width: model.size.width,
      height: model.size.height,
      displayId: meta.displayId,
      createdAt: capturedAt,
    })
    const dataUrl = `data:image/jpeg;base64,${preview.jpeg.toString('base64')}`
    preview.jpeg.fill(0)
    this.log(`capture: kept ${meta.source} image ${model.size.width}x${model.size.height}`)
    return {
      status: 'captured',
      capture: {
        captureId,
        ...meta,
        width: model.size.width,
        height: model.size.height,
        byteSize: model.jpeg.byteLength,
        capturedAt,
        preview: { dataUrl, ...preview.size },
      },
    }
  }
}

function pickSource(
  sources: CaptureSource[],
  display: CaptureDisplay,
  displayCount: number,
): CaptureSource | undefined {
  const exact = sources.find((s) => s.displayId === String(display.id))
  if (exact !== undefined) return exact
  // Some setups report no display_id; that is only unambiguous with one screen.
  return displayCount === 1 && sources.length === 1 ? sources[0] : undefined
}
