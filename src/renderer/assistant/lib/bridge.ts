import type { ScreenBuddyApi } from '@shared/bridge'

/**
 * The preload API. Everything privileged goes through here, so it is the one
 * place to swap in a fake (unit tests) or detect a missing preload.
 */
export function bridge(): ScreenBuddyApi {
  return window.screenBuddy
}
