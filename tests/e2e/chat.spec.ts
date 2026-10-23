import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { hook, launch, openChat } from './helpers'
import {
  closedPort,
  hasImage,
  startMockOpenAi,
  TEXT_ONLY_MODEL,
  textOf,
  VALID_KEY,
} from './mockOpenAi'

let userData: string
let app: ElectronApplication
let page: Page
let server: Awaited<ReturnType<typeof startMockOpenAi>>

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'screenbuddy-chat-'))
  server = await startMockOpenAi()
  ;({ app, page } = await launch(userData))
  // Short timeouts and backoff so the failure paths finish quickly.
  await hook(app, 'setAiTiming', { firstTokenMs: 8000, idleMs: 8000, totalMs: 20000 }, 20)
  await openChat(page)
})

test.afterEach(async () => {
  await app.close()
  await server.close()
  rmSync(userData, { recursive: true, force: true })
})

const input = () => page.getByRole('textbox', { name: 'Message ScreenBuddy' })
const conversation = () => page.getByRole('log')
const alert = () => page.getByRole('alert')

/** Captures and waits until the screenshot is attached (Send is disabled meanwhile). */
async function captureScreen(): Promise<void> {
  await page.getByRole('button', { name: 'Capture screen' }).click()
  await expect(page.getByRole('group', { name: 'Attached image' })).toBeVisible()
}

async function ask(text: string): Promise<void> {
  await input().fill(text)
  await input().press('Enter')
}

/** Fills in the provider settings through the real Settings UI. */
async function configure(options: { baseUrl: string; model?: string; apiKey?: string }) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page
    .getByRole('radiogroup', { name: 'AI provider' })
    .getByRole('radio', { name: 'AI provider' })
    .click()
  const baseUrl = page.getByLabel('Base URL')
  await baseUrl.fill(options.baseUrl)
  await baseUrl.press('Enter')
  const model = page.getByLabel('Model', { exact: true })
  await model.fill(options.model ?? 'vision-model')
  await model.press('Enter')
  const key = page.getByLabel('API key')
  await key.fill(options.apiKey ?? VALID_KEY)
  await key.press('Enter')
  await expect(page.getByText(/API key ••••/)).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(input()).toBeVisible()
}

test('text-only question: streams the answer word by word', async () => {
  server.setWordDelay(60)
  await configure({ baseUrl: server.baseUrl })
  await ask('What is TypeScript?')

  // Mid-stream: some words are visible while Stop is still offered.
  await expect(conversation()).toContainText('Answer')
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await expect(conversation()).toContainText('Step one, then step two.', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  // Markdown rendered: **Answer** is bold, not literal asterisks.
  await expect(conversation().locator('strong', { hasText: 'Answer' })).toBeVisible()
  await expect(conversation()).not.toContainText('**')

  const request = server.requests[0]
  expect(request?.authorization).toBe(`Bearer ${VALID_KEY}`)
  expect(request?.body).toMatchObject({ model: 'vision-model', stream: true })
  expect(request?.body.messages[0]?.role).toBe('system')
  expect(textOf(request?.body.messages[0])).toContain('You are ScreenBuddy')
  expect(request === undefined ? true : hasImage(request)).toBe(false)
})

test('screenshot question, then a follow-up in the same conversation', async () => {
  await configure({ baseUrl: server.baseUrl })
  await page.getByRole('button', { name: 'Capture screen' }).click()
  await expect(page.getByRole('group', { name: 'Attached image' })).toContainText(
    `Sending shares this image with 127.0.0.1`,
  )
  await ask('Why am I getting this error?')
  await expect(conversation()).toContainText('I can see the screenshot', { timeout: 10_000 })
  const first = server.requests[0]
  expect(first !== undefined && hasImage(first)).toBe(true)
  // The image is freed once the request completes.
  await expect.poll(() => hook(app, 'storedCaptures')).toBe(0)

  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  await ask('How do I fix it?')
  await expect(conversation()).toContainText('Answer to: How do I fix it?', { timeout: 10_000 })
  const second = server.requests[1]
  if (second === undefined) throw new Error('no follow-up request')
  expect(second.body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  expect(textOf(second.body.messages[1])).toContain('Why am I getting this error?')
  expect(textOf(second.body.messages[2])).toContain('I can see the screenshot')
  expect(hasImage(second)).toBe(false)
})

test('provider unavailable: retries, then explains and offers Retry', async () => {
  await configure({ baseUrl: await closedPort() })
  await ask('hello?')
  await expect(alert()).toContainText('Can’t reach the provider', { timeout: 10_000 })
  await expect(alert().getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('invalid API key: says so and links to Settings', async () => {
  await configure({ baseUrl: server.baseUrl, apiKey: 'sk-wrong-key-9999' })
  await ask('hello?')
  await expect(alert()).toContainText('API key rejected')
  // Rejected keys are not retried automatically.
  expect(server.requests).toHaveLength(1)
  await alert().getByRole('button', { name: 'Open Settings' }).click()
  await expect(page.getByText(/API key ••••9999/)).toBeVisible()
})

test('model without vision support: offers to send without the screenshot', async () => {
  await configure({ baseUrl: server.baseUrl, model: TEXT_ONLY_MODEL })
  await captureScreen()
  await ask('What is on screen?')
  await expect(alert()).toContainText('This model can’t see images')
  await alert().getByRole('button', { name: 'Send without screenshot' }).click()
  await expect(conversation()).toContainText('Answer to: What is on screen?', { timeout: 10_000 })
  const retried = server.requests.at(-1)
  expect(retried !== undefined && hasImage(retried)).toBe(false)
  await expect.poll(() => hook(app, 'storedCaptures')).toBe(0)
})

test('a model marked text-only never receives the screenshot', async () => {
  await configure({ baseUrl: server.baseUrl })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Model can read images' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('button', { name: 'Capture screen' }).click()
  await expect(page.getByRole('group', { name: 'Attached image' })).toContainText('won’t be sent')
  await ask('What is on screen?')
  await expect(alert()).toContainText('set up as text-only')
  expect(server.requests).toHaveLength(0)
})

test('request cancellation: Stop ends the stream and the connection', async () => {
  server.setWordDelay(400)
  await configure({ baseUrl: server.baseUrl })
  await ask('Explain slowly')
  await expect(conversation()).toContainText('Answer')
  await page.getByRole('button', { name: 'Stop response' }).click()
  await expect(conversation()).toContainText('Stopped')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  await expect.poll(() => server.aborted()).toBe(1)
  await expect(conversation()).not.toContainText('step two')
})

test('the API key never reaches the renderer or the disk in plain text', async () => {
  await configure({ baseUrl: server.baseUrl })
  const fromRenderer = await page.evaluate(() => window.screenBuddy.settings.get())
  expect(JSON.stringify(fromRenderer)).not.toContain(VALID_KEY)
  expect(fromRenderer.apiKey).toEqual({ present: true, hint: '••••0001', storage: 'keychain' })
  const secrets = join(userData, 'secrets.bin')
  expect(existsSync(secrets)).toBe(true)
  expect(readFileSync(secrets).toString('latin1')).not.toContain(VALID_KEY)
  expect(readFileSync(join(userData, 'settings.json'), 'utf8')).not.toContain(VALID_KEY)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible()
})

test('history is kept only after opting in, as text only', async () => {
  await configure({ baseUrl: server.baseUrl })
  const saved = join(userData, 'conversation.json')
  await ask('first question')
  await expect(conversation()).toContainText('Answer to: first question', { timeout: 10_000 })
  expect(existsSync(saved)).toBe(false)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Remember this conversation' }).click()
  // Opting in saves the conversation so far straight away.
  await expect
    .poll(() => existsSync(saved) && readFileSync(saved, 'utf8'))
    .toContain('first question')
  await page.getByRole('button', { name: 'Close settings' }).click()
  await captureScreen()
  await ask('second question')
  await expect
    .poll(() => readFileSync(saved, 'utf8'), { timeout: 10_000 })
    .toContain('to: second question. I can see the screenshot')
  const text = readFileSync(saved, 'utf8')
  expect(text).toContain('second question')
  expect(text).not.toContain('base64')

  await app.close()
  ;({ app, page } = await launch(userData))
  await openChat(page)
  await expect(conversation()).toContainText('second question')
  await expect(conversation()).toContainText('Screenshot (not kept)')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Remember this conversation' }).click()
  await expect.poll(() => existsSync(saved)).toBe(false)
})
