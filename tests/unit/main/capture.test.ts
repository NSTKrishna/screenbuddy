import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CaptureResult, type ScreenPermissionStatus } from '@shared/schemas/capture'
import { CaptureStore } from '../../../src/main/services/capture/CaptureStore'
import {
  fitWithin,
  MODEL_MAX_EDGE,
  physicalSize,
  PREVIEW_MAX_EDGE,
  sniffImageType,
} from '../../../src/main/services/capture/imageProcessing'
import {
  cleanFileName,
  ScreenCaptureService,
} from '../../../src/main/services/capture/ScreenCaptureService'
import type {
  CaptureBackend,
  CaptureDisplay,
  CaptureImage,
  CaptureSource,
} from '../../../src/main/services/capture/types'
import {
  PermissionService,
  SCREEN_RECORDING_SETTINGS_URL,
} from '../../../src/main/services/permissions/PermissionService'
import type { Size } from '../../../src/main/windows/geometry'

/** Every JPEG buffer any FakeImage has produced, in order. */
let encoded: Buffer[] = []

/** A pixel-less image that remembers its size and hands out recognisable JPEG bytes. */
class FakeImage implements CaptureImage {
  constructor(
    private readonly size: Size,
    private readonly empty = false,
  ) {}
  isEmpty = (): boolean => this.empty
  getSize = (): Size => this.size
  resize = (o: { width: number; height: number }): CaptureImage =>
    new FakeImage({ width: o.width, height: o.height })
  toJPEG = (): Buffer => {
    const jpeg = Buffer.alloc(64, 0xab)
    encoded.push(jpeg)
    return jpeg
  }
}

const retina: CaptureDisplay = {
  id: 1,
  label: 'Built-in Retina Display',
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2,
  isPrimary: true,
}
// Left of the laptop, so it has a negative origin; a standard-DPI monitor.
const external: CaptureDisplay = {
  id: 2,
  label: '',
  bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  isPrimary: false,
}

interface Harness {
  service: ScreenCaptureService
  store: CaptureStore
  backend: CaptureBackend & { screenSources: Mock<(size: Size) => Promise<CaptureSource[]>> }
  conceal: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  logs: string[]
  setPermission: (s: ScreenPermissionStatus) => void
}

function harness(
  options: {
    displays?: CaptureDisplay[]
    permission?: ScreenPermissionStatus
    sources?: (size: Size) => Promise<CaptureSource[]>
    activeDisplayId?: number | null
  } = {},
): Harness {
  let permission = options.permission ?? 'granted'
  const displays = options.displays ?? [retina]
  const screenSources = vi.fn<(size: Size) => Promise<CaptureSource[]>>(
    options.sources ??
      ((size: Size) =>
        Promise.resolve(
          displays.map((d) => ({ displayId: String(d.id), image: new FakeImage(size) })),
        )),
  )
  const backend = {
    displays: () => displays,
    cursorPoint: () => ({ x: 10, y: 10 }),
    screenSources,
    decodeImage: (bytes: Uint8Array) =>
      bytes.byteLength > 16 ? new FakeImage({ width: 800, height: 600 }) : null,
  }
  const restore = vi.fn()
  const conceal = vi.fn(() => Promise.resolve(restore))
  const store = new CaptureStore()
  const logs: string[] = []
  let n = 0
  const service = new ScreenCaptureService({
    backend,
    screenPermission: () => permission,
    concealer: { conceal, activeDisplayId: () => options.activeDisplayId ?? null },
    store,
    newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
    now: () => 1_700_000_000_000,
    log: (m) => logs.push(m),
  })
  return {
    service,
    store,
    backend,
    conceal,
    restore,
    logs,
    setPermission: (s) => {
      permission = s
    },
  }
}

const button = { target: { kind: 'active' }, reason: 'button' } as const

afterEach(() => {
  vi.useRealTimers()
  encoded = []
})

describe('image math', () => {
  it('fits the long edge without upscaling', () => {
    expect(fitWithin({ width: 3024, height: 1964 }, 1568)).toEqual({ width: 1568, height: 1018 })
    expect(fitWithin({ width: 1080, height: 1920 }, 1568)).toEqual({ width: 882, height: 1568 })
    expect(fitWithin({ width: 800, height: 600 }, 1568)).toEqual({ width: 800, height: 600 })
  })

  it('converts DIPs to physical pixels', () => {
    expect(physicalSize({ width: 1512, height: 982 }, 2)).toEqual({ width: 3024, height: 1964 })
    expect(physicalSize({ width: 1440, height: 900 }, 1.5)).toEqual({ width: 2160, height: 1350 })
  })

  it('identifies PNG and JPEG by magic bytes only', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'png',
    )
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
  })

  it('cleans file names for display', () => {
    expect(cleanFileName('/Users/me/Desktop/shot.png')).toBe('shot.png')
    expect(cleanFileName('C:\\tmp\\a\u0007b.png')).toBe('ab.png')
    expect(cleanFileName('')).toBe('Uploaded image')
    expect(cleanFileName(`${'x'.repeat(100)}.png`)).toHaveLength(80)
  })
})

describe('successful capture', () => {
  it('returns a preview and keeps the full image in main memory only', async () => {
    const h = harness()
    const outcome = await h.service.capture(button)
    expect(outcome.status).toBe('captured')
    if (outcome.status !== 'captured') return
    expect(CaptureResult.safeParse(outcome.capture).success).toBe(true)
    expect(outcome.capture).toMatchObject({
      source: 'screen',
      label: 'Built-in Retina Display',
      displayId: 1,
      scaleFactor: 2,
    })
    expect(outcome.capture.preview.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(h.store.size).toBe(1)
    expect(h.store.get(outcome.capture.captureId)?.jpeg.byteLength).toBeGreaterThan(0)
  })

  it('conceals the assistant during the capture and restores it afterwards', async () => {
    const h = harness()
    h.backend.screenSources.mockImplementation((size: Size) => {
      expect(h.conceal).toHaveBeenCalledOnce()
      expect(h.restore).not.toHaveBeenCalled()
      return Promise.resolve([{ displayId: '1', image: new FakeImage(size) }])
    })
    await h.service.capture(button)
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('restores the assistant even when the capture throws', async () => {
    const h = harness({ sources: () => Promise.reject(new Error('boom')) })
    const outcome = await h.service.capture(button)
    expect(outcome).toMatchObject({ status: 'failed', failure: { code: 'CAPTURE_FAILED' } })
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('never logs image data', async () => {
    const h = harness()
    const outcome = await h.service.capture(button)
    const preview = outcome.status === 'captured' ? outcome.capture.preview.dataUrl : 'missing'
    const logged = h.logs.join('\n')
    expect(logged).not.toContain('base64')
    expect(logged).not.toContain(preview.slice(30, 60))
  })

  it('schedules nothing on its own', () => {
    vi.useFakeTimers()
    harness()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('high-DPI capture', () => {
  it('requests the display at native resolution and downsizes for the model and preview', async () => {
    const h = harness()
    const outcome = await h.service.capture(button)
    expect(h.backend.screenSources).toHaveBeenCalledWith({ width: 3024, height: 1964 })
    if (outcome.status !== 'captured') throw new Error('expected capture')
    expect(outcome.capture.width).toBe(MODEL_MAX_EDGE)
    expect(outcome.capture.height).toBe(1018)
    expect(outcome.capture.preview.width).toBe(PREVIEW_MAX_EDGE)
    expect(outcome.capture.preview.height).toBe(416)
  })

  it('handles fractional scale factors', async () => {
    const scaled = { ...retina, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 1.5 }
    const h = harness({ displays: [scaled] })
    await h.service.capture(button)
    expect(h.backend.screenSources).toHaveBeenCalledWith({ width: 2160, height: 1350 })
  })
})

describe('multiple displays', () => {
  it('lists each display with a label and native size', () => {
    const h = harness({ displays: [retina, external] })
    expect(h.service.listDisplays()).toEqual([
      expect.objectContaining({
        id: 1,
        label: 'Built-in Retina Display',
        pixelWidth: 3024,
        isPrimary: true,
      }),
      expect.objectContaining({ id: 2, label: 'Display 2', pixelWidth: 1920, isPrimary: false }),
    ])
  })

  it('captures the chosen display, matched by id, at its own resolution', async () => {
    const h = harness({ displays: [retina, external] })
    const outcome = await h.service.capture({
      target: { kind: 'display', displayId: 2 },
      reason: 'button',
    })
    expect(h.backend.screenSources).toHaveBeenCalledWith({ width: 1920, height: 1080 })
    expect(outcome).toMatchObject({
      status: 'captured',
      capture: { displayId: 2, label: 'Display 2', scaleFactor: 1, width: 1568, height: 882 },
    })
  })

  it('uses the display the assistant is on for an "active" capture', async () => {
    const h = harness({ displays: [retina, external], activeDisplayId: 2 })
    const outcome = await h.service.capture(button)
    expect(outcome).toMatchObject({ capture: { displayId: 2 } })
  })

  it('falls back to the display under the cursor, then the primary', async () => {
    const h = harness({ displays: [external, retina], activeDisplayId: null })
    const outcome = await h.service.capture(button)
    // The fake cursor (10, 10) is on the Retina display.
    expect(outcome).toMatchObject({ capture: { displayId: 1 } })
  })

  it('reports a display that has been unplugged', async () => {
    const h = harness({ displays: [retina, external] })
    const outcome = await h.service.capture({
      target: { kind: 'display', displayId: 99 },
      reason: 'button',
    })
    expect(outcome).toMatchObject({ status: 'failed', failure: { code: 'DISPLAY_NOT_FOUND' } })
    expect(h.backend.screenSources).not.toHaveBeenCalled()
  })

  it('fails rather than guessing when sources lack display ids', async () => {
    const h = harness({
      displays: [retina, external],
      sources: (size) =>
        Promise.resolve([
          { displayId: '', image: new FakeImage(size) },
          { displayId: '', image: new FakeImage(size) },
        ]),
    })
    expect(await h.service.capture(button)).toMatchObject({ failure: { code: 'CAPTURE_FAILED' } })
  })

  it('accepts an unlabelled source when there is only one screen', async () => {
    const h = harness({
      sources: (size) => Promise.resolve([{ displayId: '', image: new FakeImage(size) }]),
    })
    expect((await h.service.capture(button)).status).toBe('captured')
  })
})

describe('no displays', () => {
  it('fails without trying to capture', async () => {
    const h = harness({ displays: [] })
    expect(await h.service.capture(button)).toMatchObject({
      status: 'failed',
      failure: { code: 'NO_DISPLAYS' },
    })
    expect(h.backend.screenSources).not.toHaveBeenCalled()
    expect(h.service.listDisplays()).toEqual([])
  })
})

describe('permission denied', () => {
  it.each(['denied', 'restricted'] as const)('stops before capturing when %s', async (status) => {
    const h = harness({ permission: status })
    expect(await h.service.capture(button)).toMatchObject({
      status: 'failed',
      failure: { code: 'PERMISSION_DENIED' },
    })
    expect(h.conceal).not.toHaveBeenCalled()
    expect(h.backend.screenSources).not.toHaveBeenCalled()
    expect(h.store.size).toBe(0)
  })

  it('tries once when not yet asked, and discards the result if access was refused', async () => {
    const h = harness({ permission: 'not-determined' })
    h.backend.screenSources.mockImplementation((size: Size) => {
      // The macOS prompt appears; the user declines.
      h.setPermission('denied')
      return Promise.resolve([{ displayId: '1', image: new FakeImage(size) }])
    })
    expect(await h.service.capture(button)).toMatchObject({
      failure: { code: 'PERMISSION_DENIED' },
    })
    expect(h.store.size).toBe(0)
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('succeeds when access is granted at the prompt', async () => {
    const h = harness({ permission: 'not-determined' })
    h.backend.screenSources.mockImplementation((size: Size) => {
      h.setPermission('granted')
      return Promise.resolve([{ displayId: '1', image: new FakeImage(size) }])
    })
    expect((await h.service.capture(button)).status).toBe('captured')
  })

  it('treats an empty image as a failure, not a capture', async () => {
    const h = harness({
      sources: (size) => Promise.resolve([{ displayId: '1', image: new FakeImage(size, true) }]),
    })
    expect(await h.service.capture(button)).toMatchObject({ failure: { code: 'CAPTURE_FAILED' } })
  })

  it('reports status and links only to the fixed System Settings URL', async () => {
    const openExternal = vi.fn(() => Promise.resolve())
    const mac = new PermissionService({
      platform: 'darwin',
      micStatus: () => 'granted',
      askForMic: () => Promise.resolve(true),
      screenStatus: () => 'denied',
      openExternal,
      grantee: 'Electron',
    })
    expect(mac.screenInfo()).toEqual({
      status: 'denied',
      grantee: 'Electron',
      canOpenSettings: true,
    })
    await mac.openScreenRecordingSettings()
    expect(openExternal).toHaveBeenCalledWith(SCREEN_RECORDING_SETTINGS_URL)

    const linux = new PermissionService({
      platform: 'linux',
      micStatus: () => 'granted',
      askForMic: () => Promise.resolve(true),
      screenStatus: () => 'denied',
      openExternal,
      grantee: 'ScreenBuddy',
    })
    expect(linux.screenStatus()).toBe('granted')
    await linux.openScreenRecordingSettings()
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it('reports unknown when the status call throws', () => {
    const p = new PermissionService({
      platform: 'darwin',
      micStatus: () => 'granted',
      askForMic: () => Promise.resolve(true),
      screenStatus: () => {
        throw new Error('nope')
      },
      openExternal: () => Promise.resolve(),
      grantee: 'Electron',
    })
    expect(p.screenStatus()).toBe('unknown')
  })
})

describe('canceled capture', () => {
  it('drops an image that arrives after cancel', async () => {
    let release = null as (() => void) | null
    const h = harness({
      sources: (size) =>
        new Promise((resolve) => {
          release = () => resolve([{ displayId: '1', image: new FakeImage(size) }])
        }),
    })
    const pending = h.service.capture(button)
    await vi.waitFor(() => expect(release).not.toBeNull())
    h.service.cancel()
    release?.()
    expect(await pending).toMatchObject({ status: 'failed', failure: { code: 'CANCELED' } })
    expect(h.store.size).toBe(0)
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('rejects a second capture while one is running, and recovers after', async () => {
    let release = null as (() => void) | null
    const h = harness({
      sources: (size) =>
        new Promise((resolve) => {
          release = () => resolve([{ displayId: '1', image: new FakeImage(size) }])
        }),
    })
    const first = h.service.capture(button)
    expect(await h.service.capture(button)).toMatchObject({ failure: { code: 'BUSY' } })
    await vi.waitFor(() => expect(release).not.toBeNull())
    release?.()
    expect((await first).status).toBe('captured')
    h.backend.screenSources.mockImplementation((size: Size) =>
      Promise.resolve([{ displayId: '1', image: new FakeImage(size) }]),
    )
    expect((await h.service.capture(button)).status).toBe('captured')
  })

  it('cancel with nothing running is harmless', () => {
    expect(() => harness().service.cancel()).not.toThrow()
  })
})

describe('upload fallback', () => {
  const png = new Uint8Array(64)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('stores an uploaded PNG like a capture', () => {
    const h = harness()
    const outcome = h.service.importImage({ name: '/tmp/My shot.png', bytes: png })
    expect(outcome).toMatchObject({
      status: 'captured',
      capture: { source: 'upload', label: 'My shot.png', displayId: null, width: 800 },
    })
    expect(h.store.size).toBe(1)
  })

  it('rejects files that are not PNG or JPEG, whatever their name', () => {
    const h = harness()
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(h.service.importImage({ name: 'evil.png', bytes: svg })).toMatchObject({
      failure: { code: 'INVALID_IMAGE' },
    })
    expect(h.store.size).toBe(0)
  })

  it('rejects images that fail to decode', () => {
    const truncated = png.slice(0, 8)
    expect(harness().service.importImage({ name: 'a.png', bytes: truncated })).toMatchObject({
      failure: { code: 'INVALID_IMAGE' },
    })
  })
})

describe('screenshot cleanup', () => {
  const entry = (id: string) => ({
    id,
    jpeg: Buffer.alloc(32, 0xcd),
    width: 10,
    height: 10,
    displayId: 1,
    createdAt: 0,
  })

  it('discard zero-fills the buffer and forgets it', async () => {
    const h = harness()
    const outcome = await h.service.capture(button)
    if (outcome.status !== 'captured') throw new Error('expected capture')
    const buffer = h.store.get(outcome.capture.captureId)?.jpeg
    h.service.discard(outcome.capture.captureId)
    expect(h.store.size).toBe(0)
    expect(buffer?.every((b) => b === 0)).toBe(true)
  })

  it('clearAll empties the store', async () => {
    const h = harness()
    await h.service.capture(button)
    await h.service.capture({ ...button, reason: 'retake' })
    h.service.clearAll()
    expect(h.store.size).toBe(0)
  })

  it('discarding an unknown id is harmless', () => {
    expect(() => harness().service.discard('00000000-0000-4000-8000-000000000999')).not.toThrow()
  })

  it('keeps at most three entries, evicting and zeroing the oldest', () => {
    const store = new CaptureStore()
    const first = entry('a')
    store.put(first)
    store.put(entry('b'))
    store.put(entry('c'))
    store.put(entry('d'))
    expect(store.size).toBe(3)
    expect(store.get('a')).toBeUndefined()
    expect(first.jpeg.every((b) => b === 0)).toBe(true)
  })

  it('expires entries after the TTL', () => {
    vi.useFakeTimers()
    const store = new CaptureStore({ ttlMs: 1000 })
    const e = entry('a')
    store.put(e)
    vi.advanceTimersByTime(999)
    expect(store.size).toBe(1)
    vi.advanceTimersByTime(1)
    expect(store.size).toBe(0)
    expect(e.jpeg.every((b) => b === 0)).toBe(true)
  })

  it('zeroes the preview buffer once it has been encoded', async () => {
    const h = harness()
    const outcome = await h.service.capture(button)
    if (outcome.status !== 'captured') throw new Error('expected capture')
    const kept = h.store.get(outcome.capture.captureId)?.jpeg
    // Two JPEGs are encoded: the one kept for the model, and the preview.
    expect(encoded).toHaveLength(2)
    const preview = encoded.find((b) => b !== kept)
    expect(preview?.every((b) => b === 0)).toBe(true)
    expect(kept?.some((b) => b !== 0)).toBe(true)
  })
})
