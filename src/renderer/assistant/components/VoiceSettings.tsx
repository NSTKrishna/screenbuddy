import { useEffect, useId, useState } from 'react'
import { ExternalLink, Volume2 } from 'lucide-react'
import type { ShortcutStatus } from '@shared/ipc/contract'
import type {
  MicPermissionInfo,
  MicPermissionStatus,
  VoiceSettings as Voice,
} from '@shared/schemas/voice'
import { bridge } from '../lib/bridge'
import { VOICE_SHORTCUT_LABEL } from '../lib/voiceShortcut'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useVoiceStore } from '../stores/useVoiceStore'
import { Field, inputClass, Row, Section, smallButton, Switch } from './SettingsPrimitives'

const MIC_TEXT: Record<MicPermissionStatus, { label: string; tone: string }> = {
  granted: { label: 'Allowed', tone: 'text-ok' },
  denied: { label: 'Not allowed', tone: 'text-warn' },
  restricted: { label: 'Blocked by policy', tone: 'text-warn' },
  'not-determined': { label: 'Not asked yet', tone: 'text-ink-muted' },
  unknown: { label: 'Unknown', tone: 'text-ink-muted' },
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (next: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-lg bg-black/25 p-0.5"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2 py-1 text-[12px] transition-colors duration-150 ${
            value === v ? 'bg-surface-hover text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** A text setting saved on blur or Enter; `check` returns an error message or null. */
function TextSetting({
  label,
  value,
  placeholder,
  hint,
  check,
  onSave,
}: {
  label: string
  value: string
  placeholder: string
  hint?: string
  check: (v: string) => string | null
  onSave: (v: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  const [error, setError] = useState<string | null>(null)
  if (value !== synced) {
    setSynced(value)
    setDraft(value)
  }
  const save = (): void => {
    const trimmed = draft.trim()
    const problem = check(trimmed)
    setError(problem)
    if (problem === null && trimmed !== value) onSave(trimmed)
  }
  return (
    <Field label={label} id={id} error={error} {...(hint === undefined ? {} : { hint })}>
      <input
        id={id}
        className={inputClass}
        value={draft}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
      />
    </Field>
  )
}

const identifier = (v: string): string | null =>
  v === '' || /\s/.test(v) ? 'Enter an ID without spaces.' : null

export function VoiceSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const speak = useVoiceStore((s) => s.speak)
  const [mic, setMic] = useState<MicPermissionInfo | null>(null)
  const [shortcut, setShortcut] = useState<ShortcutStatus | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    void bridge().permissions.getMicrophone().then(setMic)
    const load = (): void => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    const off = bridge().events.onVoiceShortcutStatus(setShortcut)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
      off()
    }
  }, [])

  const voice = settings?.voice
  if (voice === undefined) return null
  const set = (patch: Parameters<typeof update>[0]['voice']): void => {
    void update({ voice: patch })
  }
  const voiceMode = voice.mode === 'voice'
  const micText = mic === null ? null : MIC_TEXT[mic.status]

  return (
    <Section title="Voice">
      <div className="px-3.5 py-2.5">
        <Segmented<Voice['mode']>
          label="Conversation mode"
          value={voice.mode}
          options={[
            ['voice', 'Voice and text'],
            ['text', 'Text only'],
          ]}
          onChange={(mode) => set({ mode })}
        />
        <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
          {voiceMode
            ? 'Click the microphone to talk, and again to stop. The microphone is only on while you see the red recording indicator.'
            : 'No microphone, and nothing is read aloud.'}
        </p>
      </div>

      {voiceMode && (
        <>
          <Row
            label="Microphone"
            hint={
              mic?.status === 'not-determined'
                ? 'macOS will ask the first time you talk.'
                : undefined
            }
          >
            <span className="flex items-center gap-2">
              {micText !== null && (
                <span className={`text-[12px] ${micText.tone}`}>{micText.label}</span>
              )}
              {mic !== null && mic.status !== 'granted' && mic.canOpenSettings && (
                <button
                  type="button"
                  aria-label="Open Microphone settings"
                  onClick={() => void bridge().permissions.openMicrophoneSettings()}
                  className="inline-flex size-7 items-center justify-center rounded-lg border border-line-strong text-ink hover:bg-surface-hover"
                >
                  <ExternalLink className="size-3.5" strokeWidth={2} />
                </button>
              )}
            </span>
          </Row>
          <Row
            label="Read answers aloud"
            hint="Answers to questions you asked by voice are spoken. Typed questions stay quiet."
          >
            <Switch
              label="Read answers aloud"
              checked={voice.speakResponses}
              onChange={(speakResponses) => set({ speakResponses })}
            />
          </Row>
          <Row
            label="Send transcripts automatically"
            hint="Off: the transcript waits in the message box so you can edit it first."
          >
            <Switch
              label="Send transcripts automatically"
              checked={voice.autoSend}
              onChange={(autoSend) => set({ autoSend })}
            />
          </Row>
          <Row
            label={`Voice shortcut ${VOICE_SHORTCUT_LABEL}`}
            hint={
              shortcut !== null && voice.shortcutEnabled && !shortcut.registered
                ? 'Unavailable. Another app may already use this shortcut.'
                : 'Starts and stops listening from any app.'
            }
          >
            <Switch
              label="Voice shortcut"
              checked={voice.shortcutEnabled}
              onChange={(shortcutEnabled) => set({ shortcutEnabled })}
            />
          </Row>

          <div className="px-3.5 pt-2.5 pb-1">
            <p className="mb-1 text-[12px] text-ink-muted">Speech to text</p>
            <Segmented
              label="Transcription"
              value={voice.transcription.source}
              options={[
                ['chat-provider', 'AI provider'],
                ['mock', 'Mock (free)'],
              ]}
              onChange={(source) => set({ transcription: { source } })}
            />
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
              {voice.transcription.source === 'mock' || settings?.ai.provider === 'mock'
                ? 'Simulated transcripts; audio never leaves this Mac.'
                : 'Your recording is sent to the AI provider’s /audio/transcriptions when you stop talking, then discarded.'}
            </p>
          </div>
          {voice.transcription.source === 'chat-provider' && (
            <>
              <TextSetting
                label="Transcription model"
                value={voice.transcription.model}
                placeholder="gpt-4o-mini-transcribe"
                hint="For example gpt-4o-mini-transcribe or whisper-1."
                check={identifier}
                onSave={(model) => set({ transcription: { model } })}
              />
              <TextSetting
                label="Language (optional)"
                value={voice.transcription.language}
                placeholder="Detect automatically"
                hint="A two-letter code such as en or de makes short phrases more accurate."
                check={(v) => (/^([a-z]{2})?$/.test(v) ? null : 'Use a two-letter code like en.')}
                onSave={(language) => set({ transcription: { language } })}
              />
              <Row
                label="Live transcription"
                hint="Show words as they’re recognised, when the model supports it."
              >
                <Switch
                  label="Live transcription"
                  checked={voice.transcription.stream}
                  onChange={(stream) => set({ transcription: { stream } })}
                />
              </Row>
            </>
          )}

          <div className="px-3.5 pt-2.5 pb-1">
            <p className="mb-1 text-[12px] text-ink-muted">Spoken answers</p>
            <Segmented
              label="Speech engine"
              value={voice.speech.engine}
              options={[
                ['system', 'System voice (offline)'],
                ['provider', 'AI provider'],
              ]}
              onChange={(engine) => set({ speech: { engine } })}
            />
          </div>
          {voice.speech.engine === 'system' ? (
            <Row label="Voice">
              <select
                aria-label="System voice"
                value={voice.speech.systemVoice}
                onChange={(e) => set({ speech: { systemVoice: e.target.value } })}
                className="max-w-44 rounded-lg border border-line bg-black/20 px-2 py-1 text-[12px] text-ink outline-none"
              >
                <option value="">Default</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </Row>
          ) : (
            <>
              <TextSetting
                label="Speech model"
                value={voice.speech.providerModel}
                placeholder="gpt-4o-mini-tts"
                check={identifier}
                onSave={(providerModel) => set({ speech: { providerModel } })}
              />
              <TextSetting
                label="Provider voice"
                value={voice.speech.providerVoice}
                placeholder="alloy"
                check={identifier}
                onSave={(providerVoice) => set({ speech: { providerVoice } })}
              />
            </>
          )}
          <Row label="Speed">
            <input
              type="range"
              aria-label="Speaking speed"
              min={0.5}
              max={2}
              step={0.1}
              value={voice.rate}
              onChange={(e) => set({ rate: Number(e.target.value) })}
              className="w-32 accent-[var(--color-aurora-2)]"
            />
          </Row>
          <Row label="Volume">
            <input
              type="range"
              aria-label="Speaking volume"
              min={0}
              max={1}
              step={0.05}
              value={voice.volume}
              onChange={(e) => set({ volume: Number(e.target.value) })}
              className="w-32 accent-[var(--color-aurora-2)]"
            />
          </Row>
          <div className="px-3.5 py-2.5">
            <button
              type="button"
              className={smallButton}
              onClick={() => void speak('voice-test', 'Hi, I’m ScreenBuddy. This is how I sound.')}
            >
              <Volume2 className="size-3.5" strokeWidth={2} aria-hidden />
              Test voice
            </button>
          </div>
        </>
      )}
    </Section>
  )
}
