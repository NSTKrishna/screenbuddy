import { randomBytes } from 'node:crypto'

/**
 * Builds a `multipart/form-data` body by hand: small, deterministic, and
 * independent of whether a given `fetch` supports FormData bodies.
 */
export function multipartBody(
  fields: Record<string, string>,
  file: { field: string; filename: string; contentType: string; bytes: Uint8Array },
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = `----screenbuddy${randomBytes(12).toString('hex')}`
  const parts: Buffer[] = []
  const line = (text: string): Buffer => Buffer.from(`${text}\r\n`, 'utf8')
  for (const [name, value] of Object.entries(fields)) {
    parts.push(line(`--${boundary}`))
    parts.push(line(`Content-Disposition: form-data; name="${name}"`))
    parts.push(line(''))
    parts.push(line(value))
  }
  parts.push(line(`--${boundary}`))
  parts.push(
    line(`Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"`),
  )
  parts.push(line(`Content-Type: ${file.contentType}`))
  parts.push(line(''))
  parts.push(Buffer.from(file.bytes))
  parts.push(line(''))
  parts.push(line(`--${boundary}--`))
  const joined = Buffer.concat(parts)
  // A plain Uint8Array is a valid fetch body everywhere; wipe the intermediate copies.
  const body = new Uint8Array(joined)
  joined.fill(0)
  for (const part of parts) part.fill(0)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
