import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { BRIDGE_KEYS } from '../../src/shared/bridge'
import { hook, launch, root, state } from './helpers'

let userData: string

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'screenbuddy-e2e-'))
})

test.afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

test('launches as a sandboxed floating orb in the bottom-right corner', async () => {
  const { app, page } = await launch(userData)

  // Reload with a listener attached so nothing from startup is missed (CSP violations included).
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  await page.reload()

  await expect(page.getByRole('button', { name: 'Open ScreenBuddy' })).toBeVisible()
  expect(
    await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
  ).toBe('undefined')
  expect(await page.evaluate(() => Object.keys(window.screenBuddy).sort())).toEqual([
    ...BRIDGE_KEYS,
  ])
  expect(
    await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process),
  ).toBe('undefined')

  const s = await state(app)
  expect(s).toMatchObject({ visible: true, mode: 'collapsed', bounds: { width: 88, height: 88 } })
  const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  expect(s.bounds.x + s.bounds.width).toBe(workArea.x + workArea.width - 12)
  expect(s.bounds.y + s.bounds.height).toBe(workArea.y + workArea.height - 12)

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  const info = await page.evaluate(() => window.screenBuddy.app.getInfo())
  expect(info.version).toBe(pkg.version)

  const shortcut = await hook(app, 'shortcut')
  expect(shortcut.accelerator).toBe('CommandOrControl+Shift+Space')

  const isTop = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop(),
  )
  expect(isTop).toBe(true)
  expect(problems).toEqual([])

  await app.close()
})

test('expands to chat, streams a mock reply, and shows the error state', async () => {
  const { app, page } = await launch(userData)

  await page.getByRole('button', { name: 'Open ScreenBuddy' }).click()
  const panel = page.getByRole('region', { name: 'ScreenBuddy assistant' })
  await expect(panel).toBeVisible()
  await expect.poll(async () => (await state(app)).mode).toBe('expanded')
  const expanded = await state(app)
  expect(expanded.bounds.width).toBeGreaterThan(300)

  const input = page.getByRole('textbox', { name: 'Message ScreenBuddy' })
  await expect(input).toBeFocused()
  await input.fill('hello')
  await input.press('Enter')
  await expect(page.getByRole('status', { name: 'Thinking' })).toBeVisible()
  await expect(page.getByRole('log')).toContainText("I'm ScreenBuddy", { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 10_000 })

  await input.fill('/fail')
  await input.press('Enter')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('simulated error', { timeout: 10_000 })
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('status', { name: 'Thinking' })).toBeVisible()

  await page.getByRole('button', { name: 'Minimize to orb' }).click()
  await expect(page.getByRole('button', { name: 'Open ScreenBuddy' })).toBeVisible()
  await expect.poll(async () => (await state(app)).bounds.width).toBe(88)

  await app.close()
})

test('the toggle (shortcut handler) and Esc show and hide the assistant', async () => {
  const { app, page } = await launch(userData)

  // Orb showing → the shortcut opens the chat.
  await hook(app, 'toggle')
  await expect(page.getByRole('region', { name: 'ScreenBuddy assistant' })).toBeVisible()
  expect(await state(app)).toMatchObject({ visible: true, mode: 'expanded' })

  // Chat showing → the shortcut hides it.
  await hook(app, 'toggle')
  await expect.poll(async () => (await state(app)).visible).toBe(false)

  // Hidden → it comes back as the chat.
  await hook(app, 'toggle')
  await expect.poll(async () => (await state(app)).visible).toBe(true)
  await expect(page.getByRole('textbox', { name: 'Message ScreenBuddy' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state(app)).visible).toBe(false)

  await app.close()
})

test('the tray menu toggles, opens settings and starts a new chat', async () => {
  const { app, page } = await launch(userData)

  expect(await hook(app, 'trayLabels')).toEqual([
    'Hide ScreenBuddy',
    'New Chat',
    'Settings…',
    '',
    'Quit ScreenBuddy',
  ])

  await hook(app, 'clickTray', 'Hide ScreenBuddy')
  await expect.poll(async () => (await state(app)).visible).toBe(false)
  expect((await hook(app, 'trayLabels'))[0]).toBe('Show ScreenBuddy')

  await hook(app, 'clickTray', 'Settings…')
  await expect(page.getByText('Show or hide ScreenBuddy')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Show icon in Dock' })).toBeVisible()

  await hook(app, 'clickTray', 'New Chat')
  await expect(page.getByRole('heading', { name: 'How can I help?' })).toBeVisible()

  await app.close()
})

test('dragging moves the window and the position survives a relaunch', async () => {
  let { app, page } = await launch(userData)
  const before = (await state(app)).bounds

  // Playwright cannot move the OS cursor, so the hook feeds main a fake one
  // while real pointer events drive the renderer's drag handling.
  const orb = page.getByRole('button', { name: 'Open ScreenBuddy' })
  const box = await orb.boundingBox()
  if (box === null) throw new Error('orb has no box')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const start = { x: before.x + cx, y: before.y + cy }

  await hook(app, 'setCursor', start.x, start.y)
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 10, cy + 10)
  await hook(app, 'setCursor', start.x - 300, start.y - 200)
  await page.mouse.move(cx + 20, cy + 20)
  await page.mouse.up()

  await expect
    .poll(async () => (await state(app)).bounds)
    .toMatchObject({ x: before.x - 300, y: before.y - 200 })
  // The drag must not have opened the chat.
  await expect(orb).toBeVisible()
  const moved = (await state(app)).bounds

  // A changed setting should persist too.
  await page.evaluate(() => window.screenBuddy.settings.update({ showDockIcon: true }))

  await app.close()
  const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
    windowAnchor: { x: number; y: number }
    showDockIcon: boolean
  }
  expect(saved.windowAnchor).toMatchObject({ x: moved.x + moved.width, y: moved.y + moved.height })
  expect(saved.showDockIcon).toBe(true)

  ;({ app, page } = await launch(userData))
  expect((await state(app)).bounds).toEqual(moved)
  expect(await page.evaluate(() => window.screenBuddy.settings.get())).toMatchObject({
    showDockIcon: true,
  })
  await app.close()
})

test('quits cleanly from the tray menu', async () => {
  const { app } = await launch(userData)
  const exited = new Promise<number | null>((done) =>
    app.process().once('exit', (code) => done(code)),
  )
  await hook(app, 'clickTray', 'Quit ScreenBuddy')
  expect(await exited).toBe(0)
})
