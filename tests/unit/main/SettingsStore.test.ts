import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUT, defaultSettings } from '@shared/schemas/settings'
import { migrateSettings, SettingsStore } from '../../../src/main/services/storage/SettingsStore'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'screenbuddy-settings-'))
  file = join(dir, 'settings.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const readFile = (): unknown => JSON.parse(readFileSync(file, 'utf8'))

describe('defaults', () => {
  it('match the documented defaults', () => {
    expect(defaultSettings()).toEqual({
      schemaVersion: 1,
      shortcut: DEFAULT_SHORTCUT,
      showDockIcon: false,
      autoCaptureScreenQuestions: true,
      windowAnchor: null,
      ai: {
        provider: 'mock',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        supportsVision: true,
      },
      saveHistory: false,
      voice: defaultSettings().voice,
      annotationSeconds: 8,
    })
    expect(defaultSettings().voice).toMatchObject({
      mode: 'voice',
      speakResponses: true,
      autoSend: false,
      shortcutEnabled: false,
      transcription: { source: 'chat-provider', model: 'gpt-4o-mini-transcribe', stream: true },
      speech: { engine: 'system' },
    })
    expect(DEFAULT_SHORTCUT).toBe('CommandOrControl+Shift+Space')
  })

  it('are used when no file exists', () => {
    expect(new SettingsStore(file).get()).toEqual(defaultSettings())
  })
})

describe('migrateSettings', () => {
  it('fills in missing fields of a v1 file', () => {
    expect(migrateSettings({ schemaVersion: 1, showDockIcon: true })).toEqual({
      ...defaultSettings(),
      showDockIcon: true,
    })
  })

  it('rejects files from a newer version, non-objects and bad values', () => {
    expect(migrateSettings({ schemaVersion: 99 })).toBeNull()
    expect(migrateSettings([])).toBeNull()
    expect(migrateSettings('settings')).toBeNull()
    expect(migrateSettings({ schemaVersion: 1, showDockIcon: 'yes' })).toBeNull()
  })

  it('rejects an unversioned file, since there is no migration from v0', () => {
    expect(migrateSettings({ showDockIcon: true })).toBeNull()
  })
})

describe('SettingsStore', () => {
  it('round-trips through disk', async () => {
    const store = new SettingsStore(file, { debounceMs: 0 })
    store.update({ showDockIcon: true })
    store.setWindowAnchor({ x: 100, y: 200, displayId: 7 })
    await store.save()
    expect(readFile()).toMatchObject({ showDockIcon: true, windowAnchor: { x: 100, y: 200 } })
    expect(new SettingsStore(file).get()).toMatchObject({
      showDockIcon: true,
      windowAnchor: { x: 100, y: 200, displayId: 7 },
    })
  })

  it('exposes only public fields', () => {
    const store = new SettingsStore(file)
    store.setWindowAnchor({ x: 1, y: 2, displayId: 3 })
    expect(store.getVisible()).toEqual({
      shortcut: DEFAULT_SHORTCUT,
      showDockIcon: false,
      autoCaptureScreenQuestions: true,
      ai: defaultSettings().ai,
      saveHistory: false,
      voice: defaultSettings().voice,
      annotationSeconds: 8,
    })
  })

  it('merges nested voice settings without dropping siblings', () => {
    const store = new SettingsStore(file)
    store.update({ voice: { transcription: { model: 'whisper-1' } } })
    store.update({ voice: { transcription: { language: 'en' }, volume: 0.4 } })
    expect(store.get().voice).toMatchObject({
      volume: 0.4,
      mode: 'voice',
      transcription: { model: 'whisper-1', language: 'en', stream: true, source: 'chat-provider' },
    })
  })

  it('merges AI settings and normalises the base URL', () => {
    const store = new SettingsStore(file)
    store.update({ ai: { provider: 'openai-compatible', model: 'gpt-4.1-mini' } })
    expect(store.get().ai).toMatchObject({
      provider: 'openai-compatible',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.openai.com/v1',
    })
  })

  it('fills AI defaults into an older v1 file that has none', () => {
    expect(migrateSettings({ schemaVersion: 1, showDockIcon: true })?.ai).toEqual(
      defaultSettings().ai,
    )
  })

  it('recovers from a corrupt file and keeps it for inspection', () => {
    writeFileSync(file, '{"schemaVersion": 1, "showDock')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings())
    expect(readdirSync(dir).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('recovers from a file that fails validation', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, showDockIcon: 'definitely' }))
    expect(new SettingsStore(file).get()).toEqual(defaultSettings())
    expect(readdirSync(dir).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('debounces bursts of changes and flushes them synchronously on quit', () => {
    const store = new SettingsStore(file, { debounceMs: 60_000 })
    for (let i = 0; i < 50; i++) store.setWindowAnchor({ x: i, y: i, displayId: 1 })
    expect(readdirSync(dir)).toEqual([])
    store.flushSync()
    expect(readFile()).toMatchObject({ windowAnchor: { x: 49, y: 49 } })
  })

  it('leaves no temp files behind', async () => {
    const store = new SettingsStore(file, { debounceMs: 0 })
    store.update({ showDockIcon: true })
    await store.save()
    await store.save()
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })
})
