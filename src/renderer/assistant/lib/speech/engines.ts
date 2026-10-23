import type { VoiceError } from '@shared/schemas/voice'
import { bridge } from '../bridge'
import { sentences } from './spokenText'

export interface SpeakOptions {
  volume: number
  rate: number
  /** A system voice name; empty for the default. */
  voiceName: string
}

/** A way of reading text aloud. `speak` resolves when speech ends or is stopped. */
export interface SpeechEngine {
  speak: (text: string, options: SpeakOptions) => Promise<void>
  stop: () => void
  setVolume: (volume: number) => void
}

export class SpeechEngineError extends Error {
  constructor(readonly error: VoiceError) {
    super(error.message)
    this.name = 'SpeechEngineError'
  }
}

/** macOS voices via speechSynthesis: offline and free (D-009). */
export class SystemSpeechEngine implements SpeechEngine {
  private generation = 0
  private volume = 1

  speak(text: string, options: SpeakOptions): Promise<void> {
    this.stop()
    const generation = ++this.generation
    this.volume = options.volume
    const voice =
      options.voiceName === ''
        ? undefined
        : window.speechSynthesis.getVoices().find((v) => v.name === options.voiceName)
    const pieces = sentences(text)
    return new Promise((resolve, reject) => {
      const next = (index: number): void => {
        if (generation !== this.generation) {
          resolve()
          return
        }
        const piece = pieces[index]
        if (piece === undefined) {
          resolve()
          return
        }
        const utterance = new SpeechSynthesisUtterance(piece)
        utterance.volume = this.volume
        utterance.rate = options.rate
        if (voice !== undefined) utterance.voice = voice
        utterance.onend = () => next(index + 1)
        utterance.onerror = (e) => {
          // Stopping produces "interrupted"/"canceled": that's not a failure.
          if (e.error === 'interrupted' || e.error === 'canceled') resolve()
          else reject(new Error(`speech failed: ${e.error}`))
        }
        window.speechSynthesis.speak(utterance)
      }
      next(0)
    })
  }

  stop(): void {
    this.generation += 1
    window.speechSynthesis.cancel()
  }

  /** Applies from the next sentence; the system can't change a sentence mid-way. */
  setVolume(volume: number): void {
    this.volume = volume
  }
}

/** The AI provider's `/audio/speech`, fetched by main and played here. */
export class ProviderSpeechEngine implements SpeechEngine {
  private audio: HTMLAudioElement | null = null
  private finish: (() => void) | null = null

  async speak(text: string, options: SpeakOptions): Promise<void> {
    this.stop()
    const outcome = await bridge().voice.speak(text.slice(0, 4096))
    if (outcome.status === 'failed') throw new SpeechEngineError(outcome.error)
    const url = URL.createObjectURL(new Blob([outcome.bytes], { type: outcome.mimeType }))
    const audio = new Audio(url)
    audio.volume = options.volume
    this.audio = audio
    try {
      await new Promise<void>((resolve, reject) => {
        this.finish = resolve
        audio.onended = () => resolve()
        audio.onerror = () => reject(new Error('audio playback failed'))
        audio.play().catch(reject)
      })
    } finally {
      URL.revokeObjectURL(url)
      if (this.audio === audio) this.audio = null
      this.finish = null
    }
  }

  stop(): void {
    this.audio?.pause()
    this.audio = null
    this.finish?.()
    this.finish = null
  }

  setVolume(volume: number): void {
    if (this.audio !== null) this.audio.volume = volume
  }
}
