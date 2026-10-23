import { writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

const RATE = 48_000

/**
 * Writes a 16-bit mono WAV for Chromium's fake microphone. `segments` are
 * [kind, milliseconds]: 'voice' is a modulated tone loud enough for voice
 * activity detection, 'quiet' is digital silence.
 */
export function writeWav(path: string, segments: ['voice' | 'quiet', number][]): string {
  const samples: number[] = []
  for (const [kind, ms] of segments) {
    const n = Math.round((RATE * ms) / 1000)
    for (let i = 0; i < n; i++) {
      const t = i / RATE
      samples.push(
        kind === 'quiet'
          ? 0
          : 0.3 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)),
      )
    }
  }
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
  return path
}

/**
 * Replaces speechSynthesis so tests never make the Mac talk. It records what
 * would have been said and how often speech was cut off. Reloads the page so
 * the stub is in place before the app's code runs.
 */
export async function stubSpeech(page: Page, utteranceMs = 300): Promise<void> {
  await page.addInitScript((ms: number) => {
    const w = window as unknown as {
      __spoken: string[]
      __speechCancels: number
    }
    w.__spoken = []
    w.__speechCancels = 0
    let current: { u: SpeechSynthesisUtterance; timer: ReturnType<typeof setTimeout> } | null = null
    const fake = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      speak(u: SpeechSynthesisUtterance) {
        w.__spoken.push(u.text)
        fake.speaking = true
        const timer = setTimeout(() => {
          current = null
          fake.speaking = false
          u.onend?.(new Event('end') as SpeechSynthesisEvent)
        }, ms)
        current = { u, timer }
      },
      cancel() {
        w.__speechCancels += 1
        if (current !== null) {
          clearTimeout(current.timer)
          const { u } = current
          current = null
          fake.speaking = false
          u.onerror?.({ error: 'interrupted' } as SpeechSynthesisErrorEvent)
        }
      },
    }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: fake })
  }, utteranceMs)
  await page.reload()
}

export const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)
export const speechCancels = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speechCancels: number }).__speechCancels)
