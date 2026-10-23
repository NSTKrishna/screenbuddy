import {
  defaultSettings,
  Settings,
  SETTINGS_SCHEMA_VERSION,
  type SettingsPatch,
  VisibleSettings,
  type WindowAnchor,
} from '@shared/schemas/settings'
import { quarantine, readJsonSync, writeJsonAtomic, writeJsonAtomicSync } from './atomicJson'

/**
 * Upgrades a raw settings object one version at a time. Each entry takes
 * version N and returns version N+1. There is only v1 so far.
 */
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

export function migrateSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  let current = { ...(raw as Record<string, unknown>) }
  let version = typeof current.schemaVersion === 'number' ? current.schemaVersion : 0
  if (version > SETTINGS_SCHEMA_VERSION) return null
  while (version < SETTINGS_SCHEMA_VERSION) {
    const step = migrations[version]
    if (step === undefined) return null
    current = step(current)
    version += 1
  }
  const parsed = Settings.safeParse(current)
  return parsed.success ? parsed.data : null
}

/** Copies the fields a patch actually sets; `undefined` means "leave as is". */
function assignDefined<T extends object>(
  target: T,
  patch: { [K in keyof T]?: T[K] | undefined },
): void {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key]
    if (value !== undefined) target[key] = value
  }
}

export interface SettingsStoreOptions {
  /** Delay before a burst of changes (for example, window moves) is written. */
  debounceMs?: number
  log?: (message: string) => void
}

export class SettingsStore {
  private settings: Settings
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private readonly debounceMs: number
  private readonly log: (message: string) => void

  constructor(
    private readonly path: string,
    options: SettingsStoreOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 400
    this.log = options.log ?? (() => undefined)
    this.settings = this.load()
  }

  private load(): Settings {
    const result = readJsonSync(this.path)
    if (result.status === 'missing') return defaultSettings()
    if (result.status === 'corrupt') {
      this.log('settings: file was not valid JSON, starting from defaults')
      return defaultSettings()
    }
    const migrated = migrateSettings(result.value)
    if (migrated === null) {
      this.log('settings: file failed validation, starting from defaults')
      quarantine(this.path)
      return defaultSettings()
    }
    return migrated
  }

  get(): Readonly<Settings> {
    return this.settings
  }

  /** Stored settings a renderer may see. The API key status is added by the caller. */
  getVisible(): VisibleSettings {
    return VisibleSettings.parse(this.settings)
  }

  update(patch: SettingsPatch): VisibleSettings {
    const next: Settings = { ...this.settings, ai: { ...this.settings.ai } }
    if (patch.showDockIcon !== undefined) next.showDockIcon = patch.showDockIcon
    if (patch.autoCaptureScreenQuestions !== undefined) {
      next.autoCaptureScreenQuestions = patch.autoCaptureScreenQuestions
    }
    if (patch.saveHistory !== undefined) next.saveHistory = patch.saveHistory
    if (patch.annotationSeconds !== undefined) next.annotationSeconds = patch.annotationSeconds
    const ai = patch.ai
    if (ai !== undefined) {
      if (ai.provider !== undefined) next.ai.provider = ai.provider
      if (ai.baseUrl !== undefined) next.ai.baseUrl = ai.baseUrl
      if (ai.model !== undefined) next.ai.model = ai.model
      if (ai.supportsVision !== undefined) next.ai.supportsVision = ai.supportsVision
    }
    const voice = patch.voice
    if (voice !== undefined) {
      const merged = {
        ...next.voice,
        transcription: { ...next.voice.transcription },
        speech: { ...next.voice.speech },
      }
      const { transcription, speech, ...top } = voice
      assignDefined(merged, top)
      if (transcription !== undefined) assignDefined(merged.transcription, transcription)
      if (speech !== undefined) assignDefined(merged.speech, speech)
      next.voice = merged
    }
    this.settings = next
    this.scheduleSave()
    return this.getVisible()
  }

  setWindowAnchor(anchor: WindowAnchor | null): void {
    this.settings = { ...this.settings, windowAnchor: anchor }
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, this.debounceMs)
  }

  /** Writes now. Concurrent calls are serialized so writes never interleave. */
  save(): Promise<void> {
    this.writing = this.writing
      .then(() => writeJsonAtomic(this.path, this.settings))
      .catch(() => {
        this.log('settings: write failed')
      })
    return this.writing
  }

  /** Writes synchronously if anything is pending. Call on quit. */
  flushSync(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
    try {
      writeJsonAtomicSync(this.path, this.settings)
    } catch {
      this.log('settings: final write failed')
    }
  }
}
