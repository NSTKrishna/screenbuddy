/**
 * Voice activity detection on microphone levels (RMS, 0..1). Pure, so the
 * auto-stop rules can be unit-tested with synthetic levels.
 *
 * Recording stops by itself when the user goes quiet after speaking, when
 * nothing is said at all, or at the hard cap (ARCHITECTURE.md §6.6).
 */

export interface VadOptions {
  /** Level above which a sample counts as voice. About -34 dBFS. */
  threshold: number
  /** Voice must last this long in one go before it counts as speech (ignores clicks). */
  speechStartMs: number
  /** Quiet after speech before stopping. */
  silenceStopMs: number
  /** Give up if no speech has started by then. */
  noSpeechMs: number
  /** Hard cap on one recording. */
  maxMs: number
  /** Less total speech than this is treated as "didn't hear anything". */
  minSpeechMs: number
}

export const DEFAULT_VAD: VadOptions = {
  threshold: 0.02,
  speechStartMs: 100,
  silenceStopMs: 1600,
  noSpeechMs: 6000,
  maxMs: 60_000,
  minSpeechMs: 150,
}

export type VadDecision = 'continue' | 'silence' | 'no-speech' | 'max'

export class VoiceActivity {
  elapsedMs = 0
  /** Total time spent above the threshold once speech started. */
  speechMs = 0
  private run = 0
  private quiet = 0
  private started = false

  constructor(private readonly options: VadOptions = DEFAULT_VAD) {}

  get heardSpeech(): boolean {
    return this.started && this.speechMs >= this.options.minSpeechMs
  }

  push(level: number, dtMs: number): VadDecision {
    this.elapsedMs += dtMs
    if (level >= this.options.threshold) {
      this.run += dtMs
      this.quiet = 0
      if (!this.started && this.run >= this.options.speechStartMs) {
        this.started = true
        this.speechMs += this.run
      } else if (this.started) {
        this.speechMs += dtMs
      }
    } else {
      this.run = 0
      this.quiet += dtMs
    }
    if (this.elapsedMs >= this.options.maxMs) return 'max'
    if (this.started && this.quiet >= this.options.silenceStopMs) return 'silence'
    if (!this.started && this.elapsedMs >= this.options.noSpeechMs) return 'no-speech'
    return 'continue'
  }
}

/** Root-mean-square level of a block of samples in [-1, 1]. */
export function rms(samples: Float32Array): number {
  let sum = 0
  for (const s of samples) sum += s * s
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length)
}
