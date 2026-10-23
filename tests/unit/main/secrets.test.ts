import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger, redact } from '../../../src/main/logging/redact'
import { SecretStore, type SafeStorageLike } from '../../../src/main/services/storage/SecretStore'

/** Reversible stand-in for safeStorage; the "ciphertext" never contains the plain text. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((b) => b ^ 0x5a)).toString('utf8'),
  }
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'screenbuddy-secrets-'))
  file = join(dir, 'secrets.bin')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const KEY = 'sk-proj-abcdefghijklmnop1234'

describe('SecretStore', () => {
  it('stores the key encrypted, readable only by the user, and reads it back', () => {
    const store = new SecretStore(file, fakeSafeStorage(), undefined)
    store.setApiKey(KEY)
    const raw = readFileSync(file)
    expect(raw.toString('utf8')).not.toContain(KEY)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(new SecretStore(file, fakeSafeStorage(), undefined).getApiKey()).toBe(KEY)
  })

  it('exposes only a hint, never the key', () => {
    const store = new SecretStore(file, fakeSafeStorage(), undefined)
    expect(store.status()).toEqual({ present: false, hint: null, storage: 'none' })
    store.setApiKey(KEY)
    const status = store.status()
    expect(status).toEqual({ present: true, hint: '••••1234', storage: 'keychain' })
    expect(JSON.stringify(status)).not.toContain('abcdefgh')
  })

  it('keeps the key in memory only when encryption is unavailable', () => {
    const store = new SecretStore(file, fakeSafeStorage(false), undefined)
    store.setApiKey(KEY)
    expect(existsSync(file)).toBe(false)
    expect(store.getApiKey()).toBe(KEY)
    expect(store.status().storage).toBe('memory')
  })

  it('clear removes the key from memory and disk', () => {
    const store = new SecretStore(file, fakeSafeStorage(), undefined)
    store.setApiKey(KEY)
    store.clear()
    expect(existsSync(file)).toBe(false)
    expect(store.getApiKey()).toBeNull()
  })

  it('treats an undecryptable file as no key, without crashing', () => {
    writeFileSync(file, 'garbage')
    const broken: SafeStorageLike = {
      ...fakeSafeStorage(),
      decryptString: () => {
        throw new Error('Keychain refused')
      },
    }
    expect(new SecretStore(file, broken, undefined).getApiKey()).toBeNull()
  })

  it('prefers SCREENBUDDY_API_KEY in development', () => {
    const store = new SecretStore(file, fakeSafeStorage(), 'sk-env-key-999999')
    expect(store.getApiKey()).toBe('sk-env-key-999999')
    expect(store.status().storage).toBe('env')
  })
})

describe('redact', () => {
  it('scrubs keys, bearer tokens and image data', () => {
    const line = redact(
      `key=${KEY} auth="Bearer abc.def.ghi" img=data:image/jpeg;base64,${'A'.repeat(300)} blob=${'Zm9v'.repeat(80)}`,
    )
    expect(line).not.toContain('abcdefgh')
    expect(line).not.toContain('abc.def.ghi')
    expect(line).not.toContain('AAAA')
    expect(line).not.toContain('Zm9vZm9v')
    expect(line).toContain('[redacted]')
  })

  it('scrubs a stored key even when it has no recognisable prefix', () => {
    const store = new SecretStore(file, fakeSafeStorage(), undefined)
    store.setApiKey('ollama-custom-token-42')
    expect(redact('sent ollama-custom-token-42 to server')).toBe('sent [redacted] to server')
  })

  it('the logger applies it to every line', () => {
    const lines: string[] = []
    createLogger((l) => lines.push(l))(`failed with ${KEY}`)
    expect(lines).toEqual(['[screenbuddy] failed with sk-[redacted]'])
  })
})
