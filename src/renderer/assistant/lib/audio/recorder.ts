import type { AudioMimeType, VoiceErrorCode } from '@shared/schemas/voice'
import { DEFAULT_VAD, rms, VoiceActivity, type VadDecision, type VadOptions } from './vad'

export interface FinishedRecording {
  blob: Blob
  mimeType: AudioMimeType
  durationMs: number
  /** False when the clip was silence (or too short): it is then never sent. */
  heardSpeech: boolean
}

export interface ActiveRecording {
  /** Stops and returns the audio. The microphone is released before this resolves. */
  stop: () => Promise<FinishedRecording>
  /** Stops and throws the audio away. */
  cancel: () => void
}

export interface RecorderEvents {
  /** Called about every 50 ms with the current level (0..1) and elapsed time. */
  onLevel: (level: number, elapsedMs: number) => void
  /** Voice activity decided the recording is over. */
  onAutoStop: (reason: Exclude<VadDecision, 'continue'>) => void
}

export class MicrophoneError extends Error {
  constructor(readonly code: VoiceErrorCode) {
    super(code)
    this.name = 'MicrophoneError'
  }
}

/** Maps getUserMedia failures to what the user can do about them. */
export function microphoneErrorCode(error: unknown): VoiceErrorCode {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'MIC_DENIED'
  if (name === 'NotReadableError' || name === 'AbortError') return 'MIC_BUSY'
  return 'MIC_UNAVAILABLE'
}

const TICK_MS = 50

/**
 * Opens the microphone for one recording. Called only from the mic button
 * (or its shortcut) after main has armed the permission gate. Every path
 * that ends a recording also stops the tracks, so the macOS microphone
 * indicator turns off straight away.
 */
export async function startRecording(
  events: RecorderEvents,
  vadOptions: VadOptions = DEFAULT_VAD,
): Promise<ActiveRecording> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation keeps a spoken answer from being picked up as speech.
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    })
  } catch (error) {
    throw new MicrophoneError(microphoneErrorCode(error))
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new MicrophoneError('MIC_UNAVAILABLE')
  }

  const codec = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType: codec, audioBitsPerSecond: 32_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const vad = new VoiceActivity(vadOptions)
  const startedAt = performance.now()
  let last = startedAt
  let finished = false

  // setInterval rather than requestAnimationFrame: rAF pauses when the window is occluded.
  const ticker = setInterval(() => {
    const now = performance.now()
    analyser.getFloatTimeDomainData(samples)
    const level = rms(samples)
    const decision = vad.push(level, now - last)
    last = now
    events.onLevel(level, now - startedAt)
    if (decision !== 'continue' && !finished) events.onAutoStop(decision)
  }, TICK_MS)

  const stopTracks = (): void => {
    stream.getTracks().forEach((t) => t.stop())
    void context.close().catch(() => undefined)
  }
  const halt = (): void => {
    finished = true
    clearInterval(ticker)
  }

  recorder.start(250)

  return {
    stop: () =>
      new Promise<FinishedRecording>((resolve) => {
        if (finished) {
          resolve({ blob: new Blob(), mimeType: 'audio/webm', durationMs: 0, heardSpeech: false })
          return
        }
        halt()
        const durationMs = Math.round(performance.now() - startedAt)
        const done = (): void => {
          // The recorder has flushed its last chunk; now let go of the microphone.
          stopTracks()
          resolve({
            blob: new Blob(chunks, { type: 'audio/webm' }),
            mimeType: 'audio/webm',
            durationMs,
            heardSpeech: vad.heardSpeech,
          })
          chunks.length = 0
        }
        if (recorder.state === 'inactive') done()
        else {
          recorder.onstop = done
          recorder.stop()
        }
      }),
    cancel: () => {
      if (finished) return
      halt()
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      stopTracks()
      chunks.length = 0
    },
  }
}
