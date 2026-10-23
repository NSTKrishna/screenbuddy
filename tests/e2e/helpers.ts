import { resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { TestHooks } from '../../src/main/testing/testHooks'

export const root = resolve(__dirname, '../..')

export async function launch(
  userData: string,
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  const app = await electron.launch({
    // Launch the app directory, as `electron-vite dev` does, so package.json is read.
    args: [root],
    cwd: root,
    env: { ...env, SCREENBUDDY_E2E: '1', SCREENBUDDY_USER_DATA: userData, ...extraEnv },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The hooks are installed right after the first show.
  await expect.poll(() => app.evaluate(() => globalThis.__screenBuddyTest !== undefined)).toBe(true)
  return { app, page }
}

/** Calls one of main's E2E hooks (src/main/testing/testHooks.ts). */
export async function hook<K extends keyof TestHooks>(
  app: ElectronApplication,
  name: K,
  ...args: Parameters<TestHooks[K]>
): Promise<ReturnType<TestHooks[K]>> {
  const result = await app.evaluate(
    (_electron, [hookName, hookArgs]) => {
      const hooks = globalThis.__screenBuddyTest
      if (hooks === undefined) throw new Error('test hooks missing')
      return (hooks[hookName] as (...a: unknown[]) => unknown)(...hookArgs)
    },
    [name, args] as const,
  )
  return result as ReturnType<TestHooks[K]>
}

export const state = (app: ElectronApplication) => hook(app, 'state')

/** Expands the orb into the chat panel. */
export async function openChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open ScreenBuddy' }).click()
  await expect(page.getByRole('textbox', { name: 'Message ScreenBuddy' })).toBeVisible()
}
