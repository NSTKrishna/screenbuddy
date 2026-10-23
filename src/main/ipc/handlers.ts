import type { PublicSettings } from '@shared/schemas/settings'
import type { AiService } from '../services/ai/AiService'
import type { AnnotationService } from '../services/annotations/AnnotationService'
import type { ScreenCaptureService } from '../services/capture/ScreenCaptureService'
import type { SecretStore } from '../services/storage/SecretStore'
import type { SpeechToTextService } from '../services/voice/SpeechToTextService'
import type { TextToSpeechService } from '../services/voice/TextToSpeechService'
import type { MicrophoneGate } from '../security/microphoneGate'
import type { PermissionService } from '../services/permissions/PermissionService'
import type { AssistantWindow } from '../windows/assistantWindow'
import type { ShortcutService } from '../services/ShortcutService'
import type { SettingsStore } from '../services/storage/SettingsStore'
import type { Handlers } from './router'

export interface HandlerDeps {
  version: string
  platform: string
  assistant: AssistantWindow
  settings: SettingsStore
  shortcuts: ShortcutService
  capture: ScreenCaptureService
  permissions: PermissionService
  secrets: SecretStore
  ai: AiService
  stt: SpeechToTextService
  tts: TextToSpeechService
  microphone: MicrophoneGate
  /** Re-registers the optional voice shortcut after a settings change. */
  applyVoiceShortcut: () => void
  annotations: AnnotationService
  demoAnnotations: () => Promise<number>
  applyDockVisibility: (settings: { showDockIcon: boolean }) => void
  quit: () => void
  relaunch: () => void
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const {
    assistant,
    settings,
    shortcuts,
    capture,
    permissions,
    secrets,
    ai,
    stt,
    tts,
    microphone,
  } = deps
  const publicSettings = (): PublicSettings => ({
    ...settings.getVisible(),
    apiKey: secrets.status(),
  })
  return {
    'app:getInfo': () => ({
      version: deps.version,
      platform: deps.platform,
      shortcut: shortcuts.status(),
      mode: assistant.getMode(),
    }),
    'app:quit': () => {
      // Let the IPC reply go out before the window starts closing.
      setImmediate(deps.quit)
    },
    'app:relaunch': () => {
      setImmediate(deps.relaunch)
    },
    'settings:get': publicSettings,
    'settings:update': (patch) => {
      const savedHistory = settings.get().saveHistory
      settings.update(patch)
      const next = publicSettings()
      deps.applyDockVisibility(next)
      if (next.saveHistory !== savedHistory) ai.historyChanged(next.saveHistory)
      if (patch.voice !== undefined) deps.applyVoiceShortcut()
      return next
    },
    'window:setMode': ({ mode }) => assistant.setMode(mode),
    'window:hide': () => assistant.hide(),
    'window:resetPosition': () => assistant.resetPosition(),
    'window:dragStart': () => assistant.dragStart(),
    'window:dragMove': () => assistant.dragMove(),
    'window:dragEnd': () => assistant.dragEnd(),
    'capture:listDisplays': () => capture.listDisplays(),
    'capture:take': (request) => capture.capture(request),
    'capture:cancel': () => capture.cancel(),
    'capture:importImage': (request) => capture.importImage(request),
    'capture:discard': ({ captureId }) => capture.discard(captureId),
    'permissions:getScreen': () => permissions.screenInfo(),
    'permissions:openScreenSettings': () => permissions.openScreenRecordingSettings(),
    'secrets:setApiKey': ({ apiKey }) => {
      secrets.setApiKey(apiKey)
      return publicSettings()
    },
    'secrets:clearApiKey': () => {
      secrets.clear()
      return publicSettings()
    },
    'ai:testConnection': () => ai.testConnection(),
    'chat:send': (request) => ai.send(request),
    'chat:retry': (request) => ai.retry(request),
    'chat:cancel': ({ turnId }) => ai.cancel(turnId),
    'chat:reset': () => {
      ai.reset()
      capture.clearAll()
    },
    'chat:history': () => ai.history(),
    'permissions:getMicrophone': () => permissions.micInfo(),
    'permissions:openMicrophoneSettings': () => permissions.openMicrophoneSettings(),
    'voice:begin': async () => {
      const status = await permissions.requestMic()
      // Text-only mode never opens the microphone, whatever the page asks.
      if (status === 'granted' && settings.get().voice.mode === 'voice') microphone.arm()
      return permissions.micInfo(status)
    },
    'voice:end': () => microphone.disarm(),
    'voice:transcribe': (request) => stt.transcribe(request),
    'voice:cancelTranscription': ({ requestId }) => stt.cancel(requestId),
    'voice:speak': ({ text }) => tts.speak(text),
    'annotations:demo': async () => ({ shown: await deps.demoAnnotations() }),
    'annotations:clear': () => deps.annotations.clear(),
  }
}
