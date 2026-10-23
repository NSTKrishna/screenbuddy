import { create } from 'zustand'
import { MAX_UPLOAD_BYTES } from '@shared/limits'
import type {
  CaptureFailure,
  CaptureOutcome,
  CaptureReason,
  CaptureResult,
  CaptureTarget,
  DisplayInfo,
  ScreenPermissionInfo,
} from '@shared/schemas/capture'
import { bridge } from '../lib/bridge'

export const UPLOAD_TYPES = ['image/png', 'image/jpeg'] as const

interface CaptureState {
  status: 'idle' | 'capturing'
  /** The screenshot or upload waiting to go out with the next message. */
  attachment: CaptureResult | null
  failure: CaptureFailure | null
  displays: DisplayInfo[]
  target: CaptureTarget
  permission: ScreenPermissionInfo | null
  previewOpen: boolean

  loadDisplays: () => Promise<void>
  refreshPermission: () => Promise<void>
  setPermission: (info: ScreenPermissionInfo) => void
  setTarget: (target: CaptureTarget) => void
  /** Resolves true when a new attachment is ready for review. */
  capture: (reason: CaptureReason, target?: CaptureTarget) => Promise<boolean>
  cancel: () => void
  importFile: (file: File) => Promise<boolean>
  /** Removes the pending attachment and frees it in main. */
  remove: () => void
  /** Hands the attachment to the chat; the chat frees it once the reply is done. */
  takeForSend: () => CaptureResult | null
  dismissFailure: () => void
  setPreviewOpen: (open: boolean) => void
  /** Main has already dropped every image (window hidden); forget local references. */
  forget: () => void
}

export const useCaptureStore = create<CaptureState>()((set, get) => {
  const settle = (outcome: CaptureOutcome): boolean => {
    if (outcome.status === 'captured') {
      const previous = get().attachment
      if (previous !== null) void bridge().capture.discard(previous.captureId)
      set({ status: 'idle', attachment: outcome.capture, failure: null })
      return true
    }
    // A cancel is the user's own doing; it needs no error message.
    const failure = outcome.failure.code === 'CANCELED' ? null : outcome.failure
    set({ status: 'idle', failure })
    if (outcome.failure.code === 'PERMISSION_DENIED') void get().refreshPermission()
    if (outcome.failure.code === 'DISPLAY_NOT_FOUND') {
      set({ target: { kind: 'active' } })
      void get().loadDisplays()
    }
    return false
  }

  return {
    status: 'idle',
    attachment: null,
    failure: null,
    displays: [],
    target: { kind: 'active' },
    permission: null,
    previewOpen: false,

    loadDisplays: async () => {
      set({ displays: await bridge().capture.listDisplays() })
    },

    refreshPermission: async () => {
      set({ permission: await bridge().permissions.getScreen() })
    },

    setPermission: (permission) => set({ permission }),

    setTarget: (target) => set({ target }),

    capture: async (reason, target) => {
      if (get().status === 'capturing') return false
      const chosen = target ?? get().target
      set({ status: 'capturing', failure: null, previewOpen: false, target: chosen })
      try {
        return settle(await bridge().capture.take({ target: chosen, reason }))
      } catch {
        set({
          status: 'idle',
          failure: { code: 'CAPTURE_FAILED', message: "The screen couldn't be captured." },
        })
        return false
      }
    },

    cancel: () => {
      void bridge().capture.cancel()
    },

    importFile: async (file) => {
      if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
        set({ failure: { code: 'INVALID_IMAGE', message: 'Choose a PNG or JPEG image.' } })
        return false
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        set({ failure: { code: 'INVALID_IMAGE', message: 'That image is larger than 15 MB.' } })
        return false
      }
      set({ status: 'capturing', failure: null })
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        return settle(await bridge().capture.importImage({ name: file.name, bytes }))
      } catch {
        set({
          status: 'idle',
          failure: { code: 'INVALID_IMAGE', message: "That image couldn't be read." },
        })
        return false
      }
    },

    remove: () => {
      const { attachment } = get()
      if (attachment !== null) void bridge().capture.discard(attachment.captureId)
      set({ attachment: null, previewOpen: false })
    },

    takeForSend: () => {
      const { attachment } = get()
      set({ attachment: null, previewOpen: false })
      return attachment
    },

    dismissFailure: () => set({ failure: null }),

    setPreviewOpen: (previewOpen) => set({ previewOpen }),

    forget: () => set({ attachment: null, previewOpen: false, failure: null }),
  }
})
