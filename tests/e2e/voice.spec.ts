import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { speechCancels, spoken, stubSpeech, writeWav } from './audio'
import { hook, launch, openChat } from './helpers'
import { closedPort } from './mockOpenAi'

const MIC_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

let userData: string
let app: ElectronApplication | null = null
let page: Page

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'screenbuddy-voice-'))
})

test.afterEach(async () => {
  await app?.close()
  app = null
  rmSync(userData, { recursive: true, force: true })
})

type Clip = 'speech' | 'short' | 'silence'

/** Launches with Chromium's fake microphone playing a generated clip. */
async function start(clip: Clip, options: { speechMs?: number; init?: () => void } = {}) {
  const wav = join(userData, `${clip}.wav`)
  writeWav(
    wav,
    clip === 'speech'
      ? [
          ['quiet', 300],
          ['voice', 1200],
          ['quiet', 3000],
        ]
      : clip === 'short'
        ? [
            ['quiet', 300],
            ['voice', 350],
            ['quiet', 3000],
          ]
        : [['quiet', 8000]],
  )
  const launched = await launch(userData, { SCREENBUDDY_FAKE_AUDIO: wav })
  app = launched.app
  page = launched.page
  if (options.init !== undefined) await page.addInitScript(options.init)
  await stubSpeech(page, options.speechMs ?? 300)
  await openChat(page)
}

const mic = () => page.getByRole('button', { name: 'Start voice input' })
const input = () => page.getByRole('textbox', { name: 'Message ScreenBuddy' })
const conversation = () => page.getByRole('log')
const voiceLog = () => hook(app as ElectronApplication, 'voiceLog')
const settings = (patch: object) =>
  page.evaluate((p) => window.screenBuddy.settings.update(p), patch)
/** Auto-send transcripts and skip the screenshot review, through the real Settings UI. */
async function handsFree() {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Send transcripts automatically' }).click()
  await page.getByRole('switch', { name: 'Capture for screen questions' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
}

test('speak a question about the screen and get a spoken answer', async () => {
  await start('speech')
  await mic().click()
  // Clear recording indicator while the microphone is open.
  await expect(page.getByRole('status', { name: 'Listening' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()
  expect((await voiceLog()).micArmed).toBe(true)

  // Voice activity stops the recording; the live transcript streams in.
  await expect(page.getByTestId('partial-transcript')).toContainText('What’s', { timeout: 10_000 })
  await expect(input()).toHaveValue('What’s on my screen right now?', { timeout: 10_000 })
  const log = await voiceLog()
  expect(log).toMatchObject({ sttRequests: 1, micArmed: false, micArms: 1 })

  // Editable before sending. It's a screen question, so a screenshot is offered first.
  await input().press('Enter')
  await expect(page.getByRole('group', { name: 'Attached image' })).toBeVisible()
  await input().press('Enter')
  await expect(conversation()).toContainText('I received a screenshot', { timeout: 10_000 })

  // The answer to a spoken question is read aloud, cleaned of Markdown.
  await expect
    .poll(() => spoken(page), { timeout: 10_000 })
    .toContainEqual(expect.stringContaining('I received a screenshot'))
  await expect(page.getByRole('status', { name: 'Speaking' })).toBeHidden({ timeout: 10_000 })
})

test('typed questions are answered in text only', async () => {
  await start('speech')
  await input().fill('What can you do?')
  await input().press('Enter')
  await expect(conversation()).toContainText('look at your screen', { timeout: 10_000 })
  await page.waitForTimeout(500)
  expect(await spoken(page)).toEqual([])
})

test('permission denied: explains how to allow it and never opens the mic', async () => {
  await start('speech')
  await hook(app as ElectronApplication, 'setMicPermission', 'denied')
  await mic().click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Microphone access is off')
  await expect(alert).toContainText('Turn on Electron')
  await alert.getByRole('button', { name: 'Open System Settings' }).click()
  await expect
    .poll(async () => (await hook(app as ElectronApplication, 'captureLog')).openedUrls)
    .toContain(MIC_SETTINGS)
  expect(await voiceLog()).toMatchObject({ micArms: 0, sttRequests: 0 })
})

test('first use asks macOS once; refusing it is handled', async () => {
  await start('speech')
  await hook(app as ElectronApplication, 'setMicPermission', 'not-determined', false)
  await mic().click()
  await expect(page.getByRole('alert')).toContainText('Microphone access is off')
  expect(await voiceLog()).toMatchObject({ prompts: 1, micArms: 0 })
})

test('silence: nothing is transmitted', async () => {
  await start('silence')
  await mic().click()
  await expect(page.getByRole('status').filter({ hasText: 'I didn’t hear anything' })).toBeVisible({
    timeout: 12_000,
  })
  expect(await voiceLog()).toMatchObject({ sttRequests: 0, micArmed: false })
  await expect(input()).toHaveValue('')
})

test('short utterance: still transcribed', async () => {
  await start('short')
  await mic().click()
  await expect(input()).toHaveValue('What’s on my screen right now?', { timeout: 10_000 })
  expect((await voiceLog()).sttRequests).toBe(1)
})

test('microphone unavailable: says so', async () => {
  await start('speech', {
    init: () => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Requested device not found', 'NotFoundError'))
    },
  })
  await mic().click()
  await expect(page.getByRole('alert')).toContainText('No microphone was found')
  expect((await voiceLog()).micArmed).toBe(false)
})

test('network disconnect: transcription fails clearly and can be retried', async () => {
  await start('speech')
  await settings({ ai: { provider: 'openai-compatible', baseUrl: await closedPort() } })
  await page.evaluate(() => window.screenBuddy.secrets.setApiKey('sk-e2e-valid-key-0001'))
  await mic().click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Couldn’t reach the transcription service', { timeout: 15_000 })
  await expect(alert.getByRole('button', { name: 'Retry transcription' })).toBeVisible()
  await alert.getByRole('button', { name: 'Dismiss' }).click()
  await expect(alert).toBeHidden()
  await expect(input()).toHaveValue('')
})

test('speech interruption: Stop, and the mic button, both cut speech off', async () => {
  await start('speech', { speechMs: 8000 })
  await handsFree()

  await mic().click()
  const speaking = page.getByRole('status', { name: 'Speaking' })
  await expect(speaking).toBeVisible({ timeout: 15_000 })
  await speaking.getByRole('button', { name: 'Stop speaking' }).click()
  await expect(speaking).toBeHidden()
  expect(await speechCancels(page)).toBeGreaterThan(0)

  // Replay, then interrupt by starting a new question: speech stops before the mic opens.
  await conversation().getByRole('button', { name: 'Read aloud' }).last().click({ force: true })
  await expect(speaking).toBeVisible()
  const before = await speechCancels(page)
  await mic().click()
  await expect(speaking).toBeHidden()
  await expect(page.getByRole('status', { name: 'Listening' })).toBeVisible()
  expect(await speechCancels(page)).toBeGreaterThan(before)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status', { name: 'Listening' })).toBeHidden()
})

test('multiple consecutive questions', async () => {
  await start('speech')
  await handsFree()
  for (let i = 1; i <= 3; i++) {
    await mic().click()
    await expect(page.getByRole('status', { name: 'Speaking' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('status', { name: 'Speaking' })).toBeHidden({ timeout: 10_000 })
    await expect(conversation().getByRole('listitem')).toHaveCount(i * 2)
  }
  await expect(conversation()).toContainText('How do I fix this?')
  await expect(conversation()).toContainText('Can you explain that more simply?')
  expect((await spoken(page)).length).toBeGreaterThanOrEqual(3)
  expect(await voiceLog()).toMatchObject({ sttRequests: 3, micArms: 3, micArmed: false })
})

test('text-only mode removes the microphone', async () => {
  await start('speech')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Text only' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(mic()).toHaveCount(0)
  await expect(page.getByRole('button', { name: /spoken answers/ })).toHaveCount(0)
})
