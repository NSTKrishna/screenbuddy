import { create } from 'zustand'
import type { AssistantMode } from '@shared/ipc/contract'
import { bridge } from '../lib/bridge'

/**
 * What the window is showing. The `to*` states run while one view animates
 * out; the window is resized only after that exit finishes, so a resize never
 * shows a stale frame.
 */
export type Presentation = 'hidden' | 'orb' | 'toPanel' | 'panel' | 'toOrb'
export type View = 'chat' | 'settings'

interface UiState {
  presentation: Presentation
  view: View
  /** Bumped whenever the input should take focus. */
  focusRequest: number

  expand: () => void
  collapse: () => void
  /** Called by AnimatePresence once the outgoing view has finished animating. */
  finishTransition: () => Promise<void>
  applyVisibility: (visible: boolean, mode: AssistantMode, focusInput: boolean) => void
  setView: (view: View) => void
  requestFocus: () => void
}

export const useUiStore = create<UiState>()((set, get) => ({
  presentation: 'hidden',
  view: 'chat',
  focusRequest: 0,

  expand: () => {
    if (get().presentation === 'orb') set({ presentation: 'toPanel' })
  },

  collapse: () => {
    if (get().presentation === 'panel') set({ presentation: 'toOrb', view: 'chat' })
  },

  finishTransition: async () => {
    const { presentation } = get()
    if (presentation === 'toPanel') {
      await bridge().window.setMode('expanded')
      if (get().presentation === 'toPanel') {
        set((s) => ({ presentation: 'panel', focusRequest: s.focusRequest + 1 }))
      }
    } else if (presentation === 'toOrb') {
      await bridge().window.setMode('collapsed')
      if (get().presentation === 'toOrb') set({ presentation: 'orb' })
    }
  },

  applyVisibility: (visible, mode, focusInput) => {
    if (!visible) {
      set({ presentation: 'hidden' })
      return
    }
    set((s) => ({
      presentation: mode === 'expanded' ? 'panel' : 'orb',
      focusRequest: focusInput ? s.focusRequest + 1 : s.focusRequest,
    }))
  },

  setView: (view) => set({ view }),

  requestFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
}))
