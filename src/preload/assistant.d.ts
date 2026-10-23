import type { ScreenBuddyApi } from '@shared/bridge'

declare global {
  interface Window {
    readonly screenBuddy: ScreenBuddyApi
  }
}

export {}
