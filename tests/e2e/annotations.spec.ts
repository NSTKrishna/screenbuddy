import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { hook, launch, openChat } from './helpers'
import { startMockOpenAi, VALID_KEY } from './mockOpenAi'

let userData: string
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'screenbuddy-annotations-'))
  ;({ app, page } = await launch(userData))
  await openChat(page)
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

/** The overlay page, once it exists. */
async function overlayPage(): Promise<Page> {
  await expect.poll(() => app.windows().length).toBe(2)
  const overlay = app.windows().find((w) => w.url().includes('overlay'))
  if (overlay === undefined) throw new Error('no overlay window')
  return overlay
}

const shapes = (overlay: Page) =>
  overlay.evaluate(() =>
    Array.from(document.querySelectorAll('#shapes > g'), (g) => ({
      type: g.getAttribute('data-type'),
      x: Number(g.getAttribute('data-x')),
      y: Number(g.getAttribute('data-y')),
    })),
  )

test('manual demo: a click-through, always-on-top overlay with mapped shapes, and Clear', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Demo' }).click()

  await expect.poll(async () => (await hook(app, 'overlay')).visible).toBe(true)
  const state = await hook(app, 'overlay')
  expect(state).toMatchObject({ alwaysOnTop: true, focusable: false })
  const display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds)
  expect(state.bounds).toMatchObject({ width: display.width, height: display.height })

  const overlay = await overlayPage()
  await expect.poll(() => shapes(overlay).then((s) => s.length)).toBe(3)
  // Normalized (0.5, 0.5) and (0.2, 0.25) land where they should on this display.
  expect(await shapes(overlay)).toEqual([
    { type: 'arrow', x: Math.round(display.width * 0.5), y: Math.round(display.height * 0.5) },
    { type: 'circle', x: Math.round(display.width * 0.2), y: Math.round(display.height * 0.25) },
    { type: 'rect', x: Math.round(display.width * 0.65), y: Math.round(display.height * 0.65) },
  ])

  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Clear annotations' }).click()
  await expect.poll(async () => (await hook(app, 'overlay')).visible).toBe(false)
  expect(await shapes(overlay)).toEqual([])
})

test('annotations clear themselves after the configured time, or with Esc', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Annotation duration').selectOption('4')
  await page.getByRole('button', { name: 'Demo' }).click()
  await expect.poll(async () => (await hook(app, 'overlay')).visible).toBe(true)
  await expect.poll(async () => (await hook(app, 'overlay')).visible, { timeout: 7000 }).toBe(false)

  await page.getByRole('button', { name: 'Demo' }).click()
  await expect.poll(async () => (await hook(app, 'overlay')).visible).toBe(true)
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await hook(app, 'overlay')).visible).toBe(false)
})

test('an AI answer about a screenshot draws what it points at', async () => {
  const server = await startMockOpenAi()
  try {
    await page.evaluate(
      async ({ baseUrl, key }) => {
        await window.screenBuddy.settings.update({ ai: { provider: 'openai-compatible', baseUrl } })
        await window.screenBuddy.secrets.setApiKey(key)
      },
      { baseUrl: server.baseUrl, key: VALID_KEY },
    )
    await page.getByRole('button', { name: 'Capture screen' }).click()
    await expect(page.getByRole('group', { name: 'Attached image' })).toBeVisible()
    const input = page.getByRole('textbox', { name: 'Message ScreenBuddy' })
    await input.fill('Where is the save button?')
    await input.press('Enter')
    await expect(page.getByRole('log')).toContainText('Step one, then step two.', {
      timeout: 10_000,
    })
    // The JSON block is for the overlay, not the chat bubble.
    await expect(page.getByRole('log')).not.toContainText('annotations')

    await expect.poll(async () => (await hook(app, 'overlay')).visible).toBe(true)
    const overlay = await overlayPage()
    const bounds = (await hook(app, 'overlay')).bounds
    if (bounds === null) throw new Error('no bounds')
    await expect
      .poll(() => shapes(overlay))
      .toEqual([
        { type: 'circle', x: Math.round(bounds.width * 0.25), y: Math.round(bounds.height * 0.5) },
      ])
    await expect(page.getByRole('button', { name: 'Clear annotations' })).toBeVisible()
  } finally {
    await server.close()
  }
})
