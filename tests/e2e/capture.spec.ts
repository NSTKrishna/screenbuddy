import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { hook, launch, openChat, root } from './helpers'

const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const SAMPLE_PNG = join(root, 'resources', 'trayTemplate@2x.png') // a real 36×36 PNG

let userData: string
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'screenbuddy-capture-'))
  ;({ app, page } = await launch(userData))
  await openChat(page)
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

const attached = () => page.getByRole('group', { name: 'Attached image' })
const stored = () => hook(app, 'storedCaptures')
const captureButton = () => page.getByRole('button', { name: 'Capture screen' })

test('captures the screen, previews it, and sends it with a message', async () => {
  await captureButton().click()

  await expect(attached()).toContainText('Screenshot of Built-in Retina Display')
  // A 1512×982 @2x display is captured at 3024×1964, then sized for the model.
  await expect(attached()).toContainText('1568×1018')
  const log = await hook(app, 'captureLog')
  expect(log.requests).toEqual([{ width: 3024, height: 1964 }])
  // The assistant was invisible while the capture ran, and is back afterwards.
  expect(log.opacities).toEqual([0])
  expect(await hook(app, 'windowOpacity')).toBe(1)
  expect(await stored()).toBe(1)

  const thumb = attached().getByRole('img')
  expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640)

  await attached().getByRole('button', { name: 'Enlarge preview' }).click()
  const dialog = page.getByRole('dialog', { name: 'Screenshot preview' })
  await expect(dialog).toContainText('Mock mode never uploads anything')
  await dialog.getByRole('button', { name: 'Keep' }).click()
  await expect(dialog).toBeHidden()

  const input = page.getByRole('textbox', { name: 'Message ScreenBuddy' })
  await input.fill('What is this?')
  await input.press('Enter')
  await expect(attached()).toBeHidden()
  const conversation = page.getByRole('log')
  await expect(conversation).toContainText('Screenshot · Built-in Retina Display')
  await expect(conversation).toContainText('I received a screenshot', { timeout: 10_000 })
  // Once the request completes, main holds no image at all.
  await expect.poll(stored, { timeout: 10_000 }).toBe(0)
})

test('retake replaces the screenshot and remove frees it', async () => {
  await captureButton().click()
  await expect(attached()).toBeVisible()
  await attached().getByRole('button', { name: 'Retake screenshot' }).click()
  await expect.poll(async () => (await hook(app, 'captureLog')).requests.length).toBe(2)
  await expect.poll(stored).toBe(1)

  await attached().getByRole('button', { name: 'Remove attachment' }).click()
  await expect(attached()).toBeHidden()
  await expect.poll(stored).toBe(0)
})

test('a screen question captures for review and waits for a second Send', async () => {
  const input = page.getByRole('textbox', { name: 'Message ScreenBuddy' })
  await input.fill("What's on my screen?")
  await input.press('Enter')

  await expect(attached()).toBeVisible()
  await expect(page.getByText('Screenshot attached. Check it')).toBeVisible()
  await expect(input).toHaveValue("What's on my screen?")
  await expect(page.getByRole('log')).toHaveCount(0)

  await input.press('Enter')
  await expect(page.getByRole('log')).toContainText('Screenshot · Built-in Retina Display')
})

test('lists multiple displays and captures the chosen one at its own scale', async () => {
  await hook(app, 'setDisplays', [
    {
      id: 1,
      label: 'Built-in Retina Display',
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
      isPrimary: true,
    },
    {
      id: 2,
      label: 'DELL U2720Q',
      bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      isPrimary: false,
    },
  ])

  await page.getByRole('button', { name: 'Choose display' }).click()
  const menu = page.getByRole('menu', { name: 'Choose a display to capture' })
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    /This display/,
    /Built-in Retina Display.*3024×1964 · 2x · Main/,
    /DELL U2720Q.*1920×1080/,
  ])
  await menu.getByRole('menuitemradio', { name: /DELL U2720Q/ }).click()

  await expect(attached()).toContainText('Screenshot of DELL U2720Q')
  await expect(attached()).toContainText('1568×882')
  const log = await hook(app, 'captureLog')
  expect(log.requests.at(-1)).toEqual({ width: 1920, height: 1080 })
})

test('permission denied shows guidance, and an uploaded image works instead', async () => {
  await hook(app, 'setScreenPermission', 'denied')
  await captureButton().click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Screen Recording is off')
  await expect(alert).toContainText('Turn on Electron')
  expect((await hook(app, 'captureLog')).requests).toEqual([])
  expect(await stored()).toBe(0)

  await alert.getByRole('button', { name: 'Open System Settings' }).click()
  await expect.poll(async () => (await hook(app, 'captureLog')).openedUrls).toEqual([SETTINGS_URL])

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    alert.getByRole('button', { name: 'Upload an image instead' }).click(),
  ])
  await chooser.setFiles(SAMPLE_PNG)
  await expect(attached()).toContainText('trayTemplate@2x.png')
  await expect(attached()).toContainText('36×36')
  await expect(page.getByRole('alert')).toBeHidden()
  // Uploads cannot be "retaken".
  await expect(attached().getByRole('button', { name: 'Retake screenshot' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('Not allowed')).toBeVisible()
})

test('a file that is not really an image is refused', async () => {
  const fake = join(userData, 'notes.png')
  writeFileSync(fake, 'just some text pretending to be a PNG')
  await page.getByTestId('image-picker').setInputFiles(fake)
  await expect(page.getByRole('alert')).toContainText('Only PNG and JPEG images are supported.')
  expect(await stored()).toBe(0)
})

test('reports when there are no displays', async () => {
  await hook(app, 'setDisplays', [])
  await captureButton().click()
  await expect(page.getByRole('alert')).toContainText('No displays were found to capture.')
  expect(await stored()).toBe(0)
})

test('a capture can be canceled before anything is attached', async () => {
  await hook(app, 'setCaptureDelay', 3000)
  await captureButton().click()
  const progress = page.getByRole('status').filter({ hasText: 'Capturing screen…' })
  await expect(progress).toBeVisible()
  await progress.getByRole('button', { name: 'Cancel' }).click()
  await expect(progress).toBeHidden({ timeout: 5000 })
  await expect(attached()).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await stored()).toBe(0)
  expect(await hook(app, 'windowOpacity')).toBe(1)
})

test('hiding the window clears a pending screenshot', async () => {
  await captureButton().click()
  await expect(attached()).toBeVisible()
  expect(await stored()).toBe(1)

  await page.keyboard.press('Escape')
  await expect.poll(stored).toBe(0)
  await hook(app, 'toggle')
  await expect(page.getByRole('textbox', { name: 'Message ScreenBuddy' })).toBeVisible()
  await expect(attached()).toHaveCount(0)
})
