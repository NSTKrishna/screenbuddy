import { existsSync, readFileSync, rmSync } from 'node:fs'
import type { ApiKeyStatus } from '@shared/schemas/settings'
import { forgetSecret, registerSecret } from '../../logging/redact'
import { writeBytesAtomicSync } from './atomicJson'

/** The slice of Electron's `safeStorage` this store uses; tests pass a fake. */
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

/**
 * Holds the AI provider API key (D-005). It's encrypted with `safeStorage`,
 * whose key lives in the macOS Keychain, and written to `secrets.bin`. If
 * encryption is unavailable the key is kept in memory for this session only
 * and never written. The key leaves this class only towards the provider:
 * renderers get `status()`.
 */
export class SecretStore {
  private cached: string | null = null
  private memoryOnly: string | null = null
  private decryptFailed = false

  constructor(
    private readonly path: string,
    private readonly safeStorage: SafeStorageLike,
    /** SCREENBUDDY_API_KEY, for development. It wins over the stored key. */
    private readonly envKey: string | undefined,
    private readonly log: (message: string) => void = () => undefined,
  ) {
    if (envKey !== undefined && envKey !== '') registerSecret(envKey)
  }

  getApiKey(): string | null {
    if (this.envKey !== undefined && this.envKey !== '') return this.envKey
    if (this.memoryOnly !== null) return this.memoryOnly
    if (this.cached !== null) return this.cached
    if (this.decryptFailed || !existsSync(this.path)) return null
    try {
      const key = this.safeStorage.decryptString(readFileSync(this.path))
      this.cached = key
      registerSecret(key)
      return key
    } catch {
      // A key encrypted under another Keychain item (or a corrupt file) can't be used.
      this.decryptFailed = true
      this.log('secrets: stored API key could not be decrypted')
      return null
    }
  }

  setApiKey(apiKey: string): void {
    this.clearValues()
    registerSecret(apiKey)
    if (this.safeStorage.isEncryptionAvailable()) {
      writeBytesAtomicSync(this.path, this.safeStorage.encryptString(apiKey))
      this.cached = apiKey
    } else {
      this.log('secrets: encryption unavailable, keeping the API key in memory only')
      this.memoryOnly = apiKey
    }
  }

  clear(): void {
    this.clearValues()
    rmSync(this.path, { force: true })
  }

  status(): ApiKeyStatus {
    const key = this.getApiKey()
    if (key === null) return { present: false, hint: null, storage: 'none' }
    const storage =
      this.envKey !== undefined && this.envKey !== ''
        ? 'env'
        : this.memoryOnly !== null
          ? 'memory'
          : 'keychain'
    return { present: true, hint: `••••${key.slice(-4)}`, storage }
  }

  private clearValues(): void {
    for (const value of [this.cached, this.memoryOnly]) if (value !== null) forgetSecret(value)
    this.cached = null
    this.memoryOnly = null
    this.decryptFailed = false
  }
}
