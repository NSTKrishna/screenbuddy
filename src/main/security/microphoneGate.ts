/**
 * Whether the page may open the microphone right now (SECURITY.md §3, §7).
 * It's armed only when the user presses the mic button (`voice:begin`), and
 * disarmed when the recording ends, when the window hides, or after a hard
 * limit, whichever comes first. The session permission handler consults it,
 * so there is no path to a background or always-on microphone.
 */
export class MicrophoneGate {
  private armedUntil = 0
  private arms = 0

  constructor(
    /** Longer than the 60 s recording cap, so a real recording is never cut off. */
    private readonly maxMs = 70_000,
    private readonly now: () => number = Date.now,
  ) {}

  arm(): void {
    this.armedUntil = this.now() + this.maxMs
    this.arms += 1
  }

  disarm(): void {
    this.armedUntil = 0
  }

  isArmed(): boolean {
    return this.now() < this.armedUntil
  }

  /** For E2E assertions only. */
  armCount(): number {
    return this.arms
  }
}
