/** A captured image held in main memory until it is sent or discarded. */
export interface StoredCapture {
  id: string
  jpeg: Buffer
  width: number
  height: number
  displayId: number | null
  createdAt: number
}

export interface CaptureStoreOptions {
  maxEntries?: number
  ttlMs?: number
}

/**
 * In-memory only (D-016): a few entries, each expiring after a TTL. Removed
 * buffers are zero-filled before the reference is dropped, so the bytes do
 * not linger in the heap waiting for garbage collection.
 */
export class CaptureStore {
  private readonly entries = new Map<string, { capture: StoredCapture; timer: NodeJS.Timeout }>()
  private readonly maxEntries: number
  private readonly ttlMs: number

  constructor(options: CaptureStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 3
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
  }

  put(capture: StoredCapture): void {
    this.delete(capture.id)
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
    const timer = setTimeout(() => this.delete(capture.id), this.ttlMs)
    timer.unref()
    this.entries.set(capture.id, { capture, timer })
  }

  get(id: string): StoredCapture | undefined {
    return this.entries.get(id)?.capture
  }

  delete(id: string): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined) return false
    clearTimeout(entry.timer)
    entry.capture.jpeg.fill(0)
    this.entries.delete(id)
    return true
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.delete(id)
  }

  get size(): number {
    return this.entries.size
  }
}
