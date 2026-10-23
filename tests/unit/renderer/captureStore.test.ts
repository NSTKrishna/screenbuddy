import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureOutcome, CaptureResult } from '@shared/schemas/capture'
import { useCaptureStore } from '../../../src/renderer/assistant/stores/useCaptureStore'

let n = 0
function result(): CaptureResult {
  n += 1
  return {
    captureId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    source: 'screen',
    label: 'Built-in Retina Display',
    displayId: 1,
    width: 1568,
    height: 1018,
    scaleFactor: 2,
    byteSize: 1000,
    capturedAt: 0,
    preview: { dataUrl: 'data:image/jpeg;base64,AAAA', width: 640, height: 416 },
  }
}

const api = {
  take: vi.fn<(r: unknown) => Promise<CaptureOutcome>>(),
  discard: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
  cancel: vi.fn(() => Promise.resolve()),
  getScreen: vi.fn(() =>
    Promise.resolve({ status: 'denied' as const, grantee: 'Electron', canOpenSettings: true }),
  ),
  importImage: vi.fn<(r: unknown) => Promise<CaptureOutcome>>(),
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const capture = useCaptureStore.getState

beforeEach(() => {
  // Only the parts of window.screenBuddy these stores touch.
  Object.defineProperty(window, 'screenBuddy', {
    configurable: true,
    value: {
      capture: {
        take: api.take,
        discard: api.discard,
        cancel: api.cancel,
        importImage: api.importImage,
        listDisplays: () => Promise.resolve([]),
      },
      permissions: { getScreen: api.getScreen, openScreenSettings: () => Promise.resolve() },
    },
  })
  useCaptureStore.setState({ attachment: null, failure: null, status: 'idle' })
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('capture store', () => {
  it('attaches a successful capture and frees the one it replaces', async () => {
    const first = result()
    const second = result()
    api.take.mockResolvedValueOnce({ status: 'captured', capture: first })
    await capture().capture('button')
    expect(capture().attachment?.captureId).toBe(first.captureId)

    api.take.mockResolvedValueOnce({ status: 'captured', capture: second })
    await capture().capture('retake')
    expect(capture().attachment?.captureId).toBe(second.captureId)
    expect(api.discard).toHaveBeenCalledWith(first.captureId)
  })

  it('shows no error for a canceled capture', async () => {
    api.take.mockResolvedValueOnce({
      status: 'failed',
      failure: { code: 'CANCELED', message: 'Capture canceled.' },
    })
    expect(await capture().capture('button')).toBe(false)
    expect(capture().failure).toBeNull()
    expect(capture().status).toBe('idle')
  })

  it('loads permission guidance when access is denied', async () => {
    api.take.mockResolvedValueOnce({
      status: 'failed',
      failure: { code: 'PERMISSION_DENIED', message: 'no' },
    })
    await capture().capture('button')
    await flush()
    expect(capture().failure?.code).toBe('PERMISSION_DENIED')
    expect(capture().permission).toMatchObject({ status: 'denied', grantee: 'Electron' })
  })

  it('remove frees the image in main', async () => {
    const r = result()
    api.take.mockResolvedValueOnce({ status: 'captured', capture: r })
    await capture().capture('button')
    capture().remove()
    expect(capture().attachment).toBeNull()
    expect(api.discard).toHaveBeenCalledWith(r.captureId)
  })

  it('rejects unsupported or oversized uploads before they reach main', async () => {
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })
    expect(await capture().importFile(svg)).toBe(false)
    const huge = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: 16 * 1024 * 1024 })
    expect(await capture().importFile(huge)).toBe(false)
    expect(api.importImage).not.toHaveBeenCalled()
  })
})
