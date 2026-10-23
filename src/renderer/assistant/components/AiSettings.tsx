import { useId, useState } from 'react'
import { Check, KeyRound, LoaderCircle, PlugZap, TriangleAlert } from 'lucide-react'
import { checkBaseUrl } from '@shared/baseUrl'
import type { ConnectionTestResult } from '@shared/schemas/chat'
import type { AiProviderKind } from '@shared/schemas/settings'
import { bridge } from '../lib/bridge'
import { destinationOf } from '../lib/destination'
import { useSettingsStore } from '../stores/useSettingsStore'
import { Field, inputClass as input, Row, Section, smallButton, Switch } from './SettingsPrimitives'

/** Starting points only; every field stays editable. */
const PRESETS = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2-vision' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: null },
] as const

function ApiKeyField() {
  const settings = useSettingsStore((s) => s.settings)
  const id = useId()
  const [value, setValue] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const key = settings?.apiKey

  const save = async (): Promise<void> => {
    const trimmed = value.trim()
    if (trimmed === '') return
    setBusy(true)
    try {
      useSettingsStore.setState({ settings: await bridge().secrets.setApiKey(trimmed) })
      setValue('')
      setReplacing(false)
    } finally {
      setBusy(false)
    }
  }

  if (key?.present === true && !replacing) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <KeyRound className="size-4 shrink-0 text-ink-muted" strokeWidth={1.9} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-ink">
            API key <span className="font-mono text-ink-muted">{key.hint}</span>
          </p>
          <p className="text-[11.5px] text-ink-faint">
            {key.storage === 'keychain'
              ? 'Encrypted with your macOS Keychain. It is never shown again.'
              : key.storage === 'memory'
                ? 'Encryption is unavailable, so it is kept only until you quit.'
                : 'From the SCREENBUDDY_API_KEY environment variable.'}
          </p>
        </div>
        {key.storage !== 'env' && (
          <>
            <button type="button" className={smallButton} onClick={() => setReplacing(true)}>
              Replace
            </button>
            <button
              type="button"
              className={`${smallButton} border-danger/30 text-danger hover:bg-danger/10`}
              onClick={() => {
                void bridge()
                  .secrets.clearApiKey()
                  .then((next) => useSettingsStore.setState({ settings: next }))
              }}
            >
              Remove
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <Field
      label="API key"
      id={id}
      hint="Stored encrypted with your macOS Keychain, never in plain text. Local servers usually need none."
    >
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={input}
        />
        <button type="submit" disabled={busy || value.trim() === ''} className={smallButton}>
          Save
        </button>
        {replacing && (
          <button type="button" className={smallButton} onClick={() => setReplacing(false)}>
            Cancel
          </button>
        )}
      </form>
    </Field>
  )
}

/** Provider, endpoint, model and key. The key itself never comes back from main. */
export function AiSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const ai = settings?.ai
  const baseUrlId = useId()
  const modelId = useId()
  const [baseUrl, setBaseUrl] = useState(ai?.baseUrl ?? '')
  const [model, setModel] = useState(ai?.model ?? '')
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [test, setTest] = useState<ConnectionTestResult | 'testing' | null>(null)

  // When main's values change (a preset, URL normalisation), the fields follow.
  const [synced, setSynced] = useState({ baseUrl: ai?.baseUrl, model: ai?.model })
  if (ai !== undefined && (ai.baseUrl !== synced.baseUrl || ai.model !== synced.model)) {
    setSynced({ baseUrl: ai.baseUrl, model: ai.model })
    setBaseUrl(ai.baseUrl)
    setModel(ai.model)
  }

  if (ai === undefined) return null
  const destination = destinationOf(settings)

  const setProvider = (provider: AiProviderKind): void => {
    setTest(null)
    void update({ ai: { provider } })
  }

  const saveBaseUrl = (): void => {
    const checked = checkBaseUrl(baseUrl)
    if (!checked.ok) {
      setBaseUrlError(checked.reason)
      return
    }
    setBaseUrlError(null)
    setTest(null)
    if (checked.url !== ai.baseUrl) void update({ ai: { baseUrl: checked.url } })
  }

  const saveModel = (): void => {
    const trimmed = model.trim()
    if (trimmed === '' || /\s/.test(trimmed)) {
      setModelError('Enter a model ID without spaces, like gpt-4o-mini.')
      return
    }
    setModelError(null)
    setTest(null)
    if (trimmed !== ai.model) void update({ ai: { model: trimmed } })
  }

  return (
    <Section title="AI">
      <div className="px-3.5 py-2.5">
        <div
          role="radiogroup"
          aria-label="AI provider"
          className="grid grid-cols-2 gap-1 rounded-lg bg-black/25 p-0.5"
        >
          {(
            [
              ['mock', 'Mock (free, offline)'],
              ['openai-compatible', 'AI provider'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={ai.provider === kind}
              onClick={() => setProvider(kind)}
              className={`rounded-md px-2 py-1 text-[12px] transition-colors duration-150 ${
                ai.provider === kind ? 'bg-surface-hover text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
          {destination.mock
            ? 'Simulated answers, for trying ScreenBuddy without an account. Nothing leaves this Mac.'
            : `Any OpenAI-compatible API. Your messages, and any screenshot you choose to send, go to ${destination.host}.`}
        </p>
      </div>

      {ai.provider === 'openai-compatible' && (
        <>
          <div className="flex flex-wrap gap-1 px-3.5 py-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-ink-muted hover:border-line-strong hover:text-ink"
                onClick={() => {
                  setBaseUrlError(null)
                  setModelError(null)
                  setTest(null)
                  void update({
                    ai: { baseUrl: p.baseUrl, ...(p.model === null ? {} : { model: p.model }) },
                  })
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <Field label="Base URL" id={baseUrlId} error={baseUrlError}>
            <input
              id={baseUrlId}
              className={input}
              value={baseUrl}
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={saveBaseUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveBaseUrl()
              }}
            />
          </Field>
          <Field
            label="Model"
            id={modelId}
            error={modelError}
            hint="Use a vision-capable model to ask about screenshots."
          >
            <input
              id={modelId}
              className={input}
              value={model}
              spellCheck={false}
              placeholder="gpt-4o-mini"
              onChange={(e) => setModel(e.target.value)}
              onBlur={saveModel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveModel()
              }}
            />
          </Field>
          <ApiKeyField />
          <Row
            label="Model can read images"
            hint="Turn off for text-only models; screenshots then stay on this Mac."
          >
            <Switch
              label="Model can read images"
              checked={ai.supportsVision}
              onChange={(supportsVision) => {
                void update({ ai: { supportsVision } })
              }}
            />
          </Row>
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <button
              type="button"
              className={smallButton}
              disabled={test === 'testing'}
              onClick={() => {
                setTest('testing')
                void bridge()
                  .ai.testConnection()
                  .then(setTest)
                  .catch(() =>
                    setTest({ ok: false, code: null, message: 'The test couldn’t run.' }),
                  )
              }}
            >
              {test === 'testing' ? (
                <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
              ) : (
                <PlugZap className="size-3.5" strokeWidth={2} aria-hidden />
              )}
              Test connection
            </button>
            {test !== null && test !== 'testing' && (
              <p
                role="status"
                className={`flex min-w-0 items-start gap-1 text-[11.5px] leading-snug ${test.ok ? 'text-ok' : 'text-danger'}`}
              >
                {test.ok ? (
                  <Check className="mt-px size-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
                ) : (
                  <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                )}
                <span>{test.message}</span>
              </p>
            )}
          </div>
        </>
      )}
    </Section>
  )
}

export function HistorySettings() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  return (
    <Section title="Privacy">
      <Row
        label="Remember this conversation"
        hint="Saves the conversation’s text on this Mac so it’s still here after you quit. Screenshots are never saved. Turning this off deletes the saved copy."
      >
        <Switch
          label="Remember this conversation"
          checked={settings?.saveHistory ?? false}
          onChange={(saveHistory) => {
            void update({ saveHistory })
          }}
        />
      </Row>
    </Section>
  )
}
