import { useEffect, useState } from 'react'
import { ExternalLink, LocateFixed, Power } from 'lucide-react'
import { motion } from 'motion/react'
import type { AppInfo, ShortcutStatus } from '@shared/ipc/contract'
import type { ScreenPermissionStatus } from '@shared/schemas/capture'
import { acceleratorKeys } from '../lib/accelerator'
import { bridge } from '../lib/bridge'
import { useCaptureStore } from '../stores/useCaptureStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { AiSettings, HistorySettings } from './AiSettings'
import { VoiceSettings } from './VoiceSettings'
import { Row, Section, Switch } from './SettingsPrimitives'

const PERMISSION_TEXT: Record<ScreenPermissionStatus, { label: string; tone: string }> = {
  granted: { label: 'Allowed', tone: 'text-ok' },
  denied: { label: 'Not allowed', tone: 'text-warn' },
  restricted: { label: 'Blocked by policy', tone: 'text-warn' },
  'not-determined': { label: 'Not asked yet', tone: 'text-ink-muted' },
  unknown: { label: 'Unknown', tone: 'text-ink-muted' },
}

export function SettingsView() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const permission = useCaptureStore((s) => s.permission)
  const refreshPermission = useCaptureStore((s) => s.refreshPermission)
  const [shortcut, setShortcut] = useState<ShortcutStatus | null>(null)
  const [moved, setMoved] = useState(false)

  useEffect(() => {
    const api = bridge()
    void api.app.getInfo().then((next) => {
      setInfo(next)
      setShortcut((current) => current ?? next.shortcut)
    })
    void refreshPermission()
    return api.events.onShortcutStatus(setShortcut)
  }, [refreshPermission])

  const permissionText = permission === null ? null : PERMISSION_TEXT[permission.status]

  const keys = shortcut === null ? [] : acceleratorKeys(shortcut.accelerator, info?.platform ?? '')

  return (
    <motion.div
      className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-3"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <Section title="Keyboard">
        <Row
          label="Show or hide ScreenBuddy"
          hint={
            shortcut === null
              ? undefined
              : shortcut.registered
                ? 'Works from any app.'
                : 'Unavailable. Another app may already use this shortcut.'
          }
        >
          <span className="flex items-center gap-1" aria-label={shortcut?.accelerator}>
            {keys.map((k) => (
              <kbd
                key={k}
                className={`min-w-6 rounded-md border border-line-strong bg-white/[0.06] px-1.5 py-0.5 text-center font-sans text-[11.5px] ${shortcut?.registered === false ? 'text-warn' : 'text-ink'}`}
              >
                {k}
              </kbd>
            ))}
          </span>
        </Row>
      </Section>

      <AiSettings />

      <Section title="Screen">
        <Row
          label="Screen Recording"
          hint={
            permission === null
              ? undefined
              : permission.status === 'granted'
                ? 'ScreenBuddy can capture when you ask it to.'
                : permission.status === 'not-determined'
                  ? 'macOS will ask the first time you capture.'
                  : `Turn on “${permission.grantee}” in System Settings, then relaunch.`
          }
        >
          <span className="flex items-center gap-2">
            {permissionText !== null && (
              <span className={`text-[12px] ${permissionText.tone}`}>{permissionText.label}</span>
            )}
            {permission !== null &&
              permission.status !== 'granted' &&
              permission.canOpenSettings && (
                <button
                  type="button"
                  aria-label="Open Screen Recording settings"
                  title="Open System Settings"
                  onClick={() => void bridge().permissions.openScreenSettings()}
                  className="inline-flex size-7 items-center justify-center rounded-lg border border-line-strong text-ink hover:bg-surface-hover"
                >
                  <ExternalLink className="size-3.5" strokeWidth={2} />
                </button>
              )}
          </span>
        </Row>
        <Row
          label="Capture for screen questions"
          hint="Asking about your screen attaches a screenshot. You always review it before it's sent."
        >
          <Switch
            label="Capture for screen questions"
            checked={settings?.autoCaptureScreenQuestions ?? true}
            onChange={(next) => {
              void updateSettings({ autoCaptureScreenQuestions: next })
            }}
          />
        </Row>
      </Section>

      <Section title="Annotations">
        <Row
          label="Show demo annotations"
          hint="Draws an arrow, a circle and a box on this display. The overlay never blocks clicks."
        >
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void bridge().annotations.demo()}
              className="rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-surface-hover"
            >
              Demo
            </button>
            <button
              type="button"
              onClick={() => void bridge().annotations.clear()}
              className="rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-surface-hover"
            >
              Clear annotations
            </button>
          </span>
        </Row>
        <Row
          label="Keep annotations for"
          hint="Answers about a screenshot can point at what they mean."
        >
          <select
            aria-label="Annotation duration"
            value={settings?.annotationSeconds ?? 8}
            onChange={(e) => void updateSettings({ annotationSeconds: Number(e.target.value) })}
            className="rounded-lg border border-line bg-black/20 px-2 py-1 text-[12px] text-ink outline-none"
          >
            {[4, 8, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} seconds
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <VoiceSettings />

      <HistorySettings />

      <Section title="Window">
        {info?.platform === 'darwin' && (
          <Row label="Show icon in Dock" hint="ScreenBuddy always lives in the menu bar.">
            <Switch
              label="Show icon in Dock"
              checked={settings?.showDockIcon ?? false}
              onChange={(next) => {
                void updateSettings({ showDockIcon: next })
              }}
            />
          </Row>
        )}
        <Row
          label="Position"
          hint={moved ? 'Moved to the bottom-right corner.' : 'Drag the header or the orb to move.'}
        >
          <button
            type="button"
            onClick={() => {
              void bridge()
                .window.resetPosition()
                .then(() => setMoved(true))
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink transition-colors duration-150 hover:bg-surface-hover"
          >
            <LocateFixed className="size-3.5" strokeWidth={2} aria-hidden />
            Reset
          </button>
        </Row>
      </Section>

      <Section title="About">
        <Row
          label="ScreenBuddy"
          hint={info === null ? undefined : `Version ${info.version}, preview build`}
        >
          <button
            type="button"
            onClick={() => void bridge().app.quit()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1 text-[12px] text-danger transition-colors duration-150 hover:bg-danger/10"
          >
            <Power className="size-3.5" strokeWidth={2} aria-hidden />
            Quit
          </button>
        </Row>
      </Section>
    </motion.div>
  )
}
