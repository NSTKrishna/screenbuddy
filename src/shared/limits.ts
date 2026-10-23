/** Limits shared by main and renderers. No imports, so renderers can use them without zod. */

/** Upper bound for an uploaded image. Larger files are rejected before decoding. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/** Upper bound for one recording sent for transcription (60 s of Opus is about 1 MB). */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024
