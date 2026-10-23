/**
 * Scrubs secrets and image data from anything about to be logged
 * (SECURITY.md §5). It's a backstop: call sites already avoid logging
 * payloads, and this catches mistakes.
 */

const PATTERNS: [RegExp, string][] = [
  // OpenAI-style keys, and the same shape used by many compatible providers.
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]'],
  [/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]'],
  [/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:[redacted]'],
  // Long base64 runs: images, audio, encrypted blobs.
  [/[A-Za-z0-9+/]{200,}={0,2}/g, '[redacted base64]'],
]

const knownSecrets = new Set<string>()

/** Registers a value that must never appear in logs, such as the current API key. */
export function registerSecret(value: string): void {
  if (value.length >= 6) knownSecrets.add(value)
}

export function forgetSecret(value: string): void {
  knownSecrets.delete(value)
}

export function redact(text: string): string {
  let out = text
  for (const secret of knownSecrets) out = out.split(secret).join('[redacted]')
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}

export function createLogger(sink: (line: string) => void = (l) => console.log(l)) {
  return (message: string): void => {
    sink(`[screenbuddy] ${redact(message)}`)
  }
}
