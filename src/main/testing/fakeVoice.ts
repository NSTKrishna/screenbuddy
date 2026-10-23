import type { MicPermissionStatus } from '@shared/schemas/voice'
import type { TranscriptionProvider } from '../services/voice/transcription'

/**
 * E2E stand-in for the macOS microphone permission (D-018). The audio itself
 * comes from Chromium's fake capture device, fed a WAV file chosen per test.
 */
export interface FakeVoiceState {
  micStatus: MicPermissionStatus
  /** What the macOS prompt "answers" when the status is not-determined. */
  promptAnswer: boolean
  prompts: number
  /** Recordings that reached a transcription provider. */
  sttRequests: number
}

export function createFakeVoice() {
  const state: FakeVoiceState = {
    micStatus: 'granted',
    promptAnswer: true,
    prompts: 0,
    sttRequests: 0,
  }
  return {
    state,
    micStatus: () => state.micStatus,
    askForMic: () => {
      state.prompts += 1
      state.micStatus = state.promptAnswer ? 'granted' : 'denied'
      return Promise.resolve(state.promptAnswer)
    },
    /** Wraps a provider so tests can count what was actually sent. */
    counted: (provider: TranscriptionProvider): TranscriptionProvider => ({
      name: provider.name,
      transcribe: (clip, options) => {
        state.sttRequests += 1
        return provider.transcribe(clip, options)
      },
    }),
  }
}
