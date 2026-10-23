import { create } from 'zustand'
import type { PublicSettings, SettingsPatch } from '@shared/schemas/settings'
import { bridge } from '../lib/bridge'

/** A mirror of main's PublicSettings (D-013). Main stays the source of truth. */
interface SettingsState {
  settings: PublicSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  load: async () => {
    set({ settings: await bridge().settings.get() })
  },
  update: async (patch) => {
    set({ settings: await bridge().settings.update(patch) })
  },
}))
