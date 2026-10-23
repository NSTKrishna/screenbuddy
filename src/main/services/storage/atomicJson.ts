import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ReadResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'corrupt'; backupPath: string | null }

/**
 * Reads and JSON-parses `path`. A file that is not valid JSON is moved aside
 * to `<path>.corrupt-<timestamp>` so the caller can start fresh without
 * losing the evidence.
 */
export function readJsonSync(path: string, now: () => number = Date.now): ReadResult {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return { status: 'missing' }
    throw error
  }
  try {
    return { status: 'ok', value: JSON.parse(text) as unknown }
  } catch {
    return { status: 'corrupt', backupPath: quarantine(path, now) }
  }
}

/** Moves a bad file out of the way. Returns the new path, or null if that failed too. */
export function quarantine(path: string, now: () => number = Date.now): string | null {
  const backupPath = `${path}.corrupt-${now()}`
  try {
    renameSync(path, backupPath)
    return backupPath
  } catch {
    return null
  }
}

function tempPathFor(path: string): string {
  return `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
}

/** Writes via a temp file and rename, so a crash never leaves a half-written file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = tempPathFor(path)
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/** Synchronous variant for the quit path, where async work may not finish. */
export function writeJsonAtomicSync(path: string, value: unknown): void {
  const tmp = tempPathFor(path)
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** Writes raw bytes atomically, readable only by the current user. */
export function writeBytesAtomicSync(path: string, bytes: Uint8Array): void {
  const tmp = tempPathFor(path)
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(tmp, bytes, { mode: 0o600 })
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}
