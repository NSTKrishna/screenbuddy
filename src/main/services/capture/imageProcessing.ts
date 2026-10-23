import type { Size } from '../../windows/geometry'
import type { CaptureImage } from './types'

/** Long edge of the image kept for the model. Larger adds cost without helping vision models. */
export const MODEL_MAX_EDGE = 1568
export const MODEL_JPEG_QUALITY = 80
/** Long edge of the preview sent to the renderer for review. */
export const PREVIEW_MAX_EDGE = 640
export const PREVIEW_JPEG_QUALITY = 72

/** Scales `size` down (never up) so its long edge is at most `maxEdge`. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const longEdge = Math.max(size.width, size.height)
  if (longEdge <= maxEdge) return { width: size.width, height: size.height }
  const scale = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/** A display's native resolution: DIP size × scale factor. */
export function physicalSize(dipSize: Size, scaleFactor: number): Size {
  return {
    width: Math.round(dipSize.width * scaleFactor),
    height: Math.round(dipSize.height * scaleFactor),
  }
}

export interface EncodedImage {
  jpeg: Buffer
  size: Size
}

export function encodeJpeg(image: CaptureImage, maxEdge: number, quality: number): EncodedImage {
  const source = image.getSize()
  const size = fitWithin(source, maxEdge)
  const scaled =
    size.width === source.width && size.height === source.height
      ? image
      : image.resize({ ...size, quality: 'best' })
  return { jpeg: scaled.toJPEG(quality), size }
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

/** Only PNG and JPEG uploads are decoded; the magic bytes decide, not the file name. */
export function sniffImageType(bytes: Uint8Array): 'png' | 'jpeg' | null {
  const starts = (sig: number[]): boolean => sig.every((b, i) => bytes[i] === b)
  if (starts(PNG)) return 'png'
  if (starts(JPEG)) return 'jpeg'
  return null
}
