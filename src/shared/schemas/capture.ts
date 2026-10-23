import { z } from 'zod'
import { MAX_UPLOAD_BYTES } from '../limits'

export { MAX_UPLOAD_BYTES }

const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

/** A connected display as the renderer sees it. Sizes are DIPs unless noted. */
export const DisplayInfo = z.object({
  id: z.number().int(),
  label: z.string().max(200),
  bounds: Rect,
  scaleFactor: z.number().positive(),
  /** Native resolution in physical pixels (DIP size × scale factor). */
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
  isPrimary: z.boolean(),
})
export type DisplayInfo = z.infer<typeof DisplayInfo>

/**
 * Which display to capture. `active` is the display the assistant is on,
 * which is where the user's attention is when they click Capture.
 */
export const CaptureTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({ kind: z.literal('display'), displayId: z.number().int() }),
])
export type CaptureTarget = z.infer<typeof CaptureTarget>

/** Why a capture happened. Every reason is a direct user action (SECURITY.md §7). */
export const CaptureReason = z.enum(['button', 'question', 'retake'])
export type CaptureReason = z.infer<typeof CaptureReason>

export const CaptureRequest = z.strictObject({
  target: CaptureTarget,
  reason: CaptureReason,
})
export type CaptureRequest = z.infer<typeof CaptureRequest>

export const ImportImageRequest = z.strictObject({
  name: z.string().max(255),
  bytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 0 && b.byteLength <= MAX_UPLOAD_BYTES, 'Image too large'),
})
export type ImportImageRequest = z.infer<typeof ImportImageRequest>

const PREVIEW_PREFIX = 'data:image/jpeg;base64,'

/**
 * What the renderer gets back. The full image never crosses IPC; it stays in
 * main, keyed by `captureId`. Only a small preview is sent for review.
 */
export const CaptureResult = z.object({
  captureId: z.uuid(),
  source: z.enum(['screen', 'upload']),
  /** Display name for a screen capture, or the file name for an upload. */
  label: z.string().max(255),
  displayId: z.number().int().nullable(),
  /** Size of the image that would be sent, in pixels. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().positive(),
  byteSize: z.number().int().nonnegative(),
  capturedAt: z.number().int(),
  preview: z.object({
    dataUrl: z
      .string()
      .max(2_000_000)
      .refine((s) => s.startsWith(PREVIEW_PREFIX), 'Preview must be a JPEG data URL'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
})
export type CaptureResult = z.infer<typeof CaptureResult>

export const CaptureFailureCode = z.enum([
  'PERMISSION_DENIED',
  'NO_DISPLAYS',
  'DISPLAY_NOT_FOUND',
  'CAPTURE_FAILED',
  'CANCELED',
  'BUSY',
  'INVALID_IMAGE',
])
export type CaptureFailureCode = z.infer<typeof CaptureFailureCode>

export const CaptureFailure = z.object({
  code: CaptureFailureCode,
  message: z.string().max(500),
})
export type CaptureFailure = z.infer<typeof CaptureFailure>

export const CaptureOutcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('captured'), capture: CaptureResult }),
  z.object({ status: z.literal('failed'), failure: CaptureFailure }),
])
export type CaptureOutcome = z.infer<typeof CaptureOutcome>

/** Mirrors `systemPreferences.getMediaAccessStatus('screen')`. */
export const ScreenPermissionStatus = z.enum([
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'unknown',
])
export type ScreenPermissionStatus = z.infer<typeof ScreenPermissionStatus>

export const ScreenPermissionInfo = z.object({
  status: ScreenPermissionStatus,
  /** The name macOS lists in Privacy settings ("Electron" in development). */
  grantee: z.string().max(100),
  /** Whether a System Settings deep link exists on this platform. */
  canOpenSettings: z.boolean(),
})
export type ScreenPermissionInfo = z.infer<typeof ScreenPermissionInfo>
