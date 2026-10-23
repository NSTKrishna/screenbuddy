import { join } from 'node:path'
import {
  app,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  safeStorage,
  shell,
  systemPreferences,
  type MenuItemConstructorOptions,
} from 'electron'
import trayIcon from '../../resources/trayTemplate.png?asset'
import { registerIpcRouter } from './ipc/router'
import { createLogger } from './logging/redact'
import { AiService } from './services/ai/AiService'
import { MockProvider } from './services/ai/MockProvider'
import { AnnotationService } from './services/annotations/AnnotationService'
import { DEMO_ANNOTATIONS, parseAnnotations } from './services/annotations/coordinates'
import { OpenAiCompatibleProvider } from './services/ai/OpenAiCompatibleProvider'
import { createHandlers } from './ipc/handlers'
import { installSecurityGuards } from './security/guards'
import { MicrophoneGate } from './security/microphoneGate'
import { assistantRendererLocation, isAppUrl } from './security/rendererOrigin'
import { CaptureStore } from './services/capture/CaptureStore'
import { electronCaptureBackend } from './services/capture/electronBackend'
import { ScreenCaptureService } from './services/capture/ScreenCaptureService'
import { PermissionService } from './services/permissions/PermissionService'
import { ShortcutService } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { ConversationStore } from './services/storage/ConversationStore'
import { SecretStore } from './services/storage/SecretStore'
import { SettingsStore } from './services/storage/SettingsStore'
import { SpeechToTextService } from './services/voice/SpeechToTextService'
import { TextToSpeechService } from './services/voice/TextToSpeechService'
import {
  MockTranscriptionProvider,
  OpenAiTranscriptionProvider,
} from './services/voice/transcription'
import { VOICE_SHORTCUT } from '@shared/schemas/voice'
import { AssistantWindow } from './windows/assistantWindow'

const isE2E = process.env.SCREENBUDDY_E2E === '1' && !app.isPackaged
const isMac = process.platform === 'darwin'

// Call sites never log payloads, settings values or user text; the logger
// also scrubs keys and image data as a backstop (SECURITY.md §5).
const log = createLogger()

if (isE2E && process.env.SCREENBUDDY_USER_DATA !== undefined) {
  app.setPath('userData', process.env.SCREENBUDDY_USER_DATA)
}
if (isE2E) {
  // safeStorage uses a throwaway in-memory keychain, never the real Keychain.
  app.commandLine.appendSwitch('use-mock-keychain')
  // The microphone is Chromium's fake device, never real hardware. A test can
  // feed it a WAV file (speech, silence) through SCREENBUDDY_FAKE_AUDIO; it
  // loops, so every recording in a test hears the same clip.
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  const audio = process.env.SCREENBUDDY_FAKE_AUDIO
  if (audio !== undefined && audio !== '') {
    app.commandLine.appendSwitch('use-file-for-fake-audio-capture', audio)
    // The sandboxed audio service can't read the clip; run audio in-process for tests only.
    app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
  }
}

let isQuitting = false
let assistant: AssistantWindow | null = null
let shortcuts: ShortcutService | null = null
let settings: SettingsStore | null = null
let tray: TrayService | null = null
let captureStore: CaptureStore | null = null
let voiceShortcuts: ShortcutService | null = null
let annotationService: AnnotationService | null = null

function applyDockVisibility(value: { showDockIcon: boolean }): void {
  if (!isMac || app.dock === undefined) return
  if (value.showDockIcon) void app.dock.show()
  else app.dock.hide()
}

function installApplicationMenu(): void {
  // Even with no Dock icon, the menu supplies ⌘C/⌘V/⌘Q/⌘W key equivalents.
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Window', submenu: [{ role: 'close' }] },
  ]
  if (!app.isPackaged) template.push({ role: 'viewMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function start(): Promise<void> {
  const location = assistantRendererLocation(
    process.env.ELECTRON_RENDERER_URL,
    join(__dirname, '..'),
  )
  const microphone = new MicrophoneGate()
  installSecurityGuards(location, microphone)
  installApplicationMenu()

  const store = new SettingsStore(join(app.getPath('userData'), 'settings.json'), { log })
  settings = store
  applyDockVisibility(store.get())

  // In E2E the real capture backend and TCC are replaced by fakes (D-018).
  const fake = isE2E ? (await import('./testing/fakeCapture')).createFakeCapture() : null
  const fakeVoice = isE2E ? (await import('./testing/fakeVoice')).createFakeVoice() : null
  const permissions = new PermissionService({
    platform: process.platform,
    screenStatus: fake?.screenStatus ?? (() => systemPreferences.getMediaAccessStatus('screen')),
    micStatus: fakeVoice?.micStatus ?? (() => systemPreferences.getMediaAccessStatus('microphone')),
    askForMic: fakeVoice?.askForMic ?? (() => systemPreferences.askForMediaAccess('microphone')),
    openExternal: fake?.openExternal ?? ((url) => shell.openExternal(url)),
    // In development macOS attributes the grant to the Electron binary.
    grantee: app.isPackaged ? app.getName() : 'Electron',
  })
  const captures = new CaptureStore()
  captureStore = captures
  const secrets = new SecretStore(
    join(app.getPath('userData'), 'secrets.bin'),
    safeStorage,
    // A development convenience only (SECURITY.md §5); ignored when packaged and in E2E.
    app.isPackaged || isE2E ? undefined : process.env.SCREENBUDDY_API_KEY,
    log,
  )
  const conversation = new ConversationStore(
    join(app.getPath('userData'), 'conversation.json'),
    log,
  )

  const refreshTray = (): void => {
    if (tray === null || assistant === null || shortcuts === null) return
    const status = shortcuts.status()
    tray.refresh({
      visible: assistant.isVisible(),
      accelerator: status.accelerator,
      shortcutRegistered: status.registered,
    })
  }

  const win = new AssistantWindow({
    preloadPath: join(__dirname, '../preload/assistant.js'),
    location,
    settings: store,
    isQuitting: () => isQuitting,
    onVisibilityChange: (visible) => {
      refreshTray()
      // Pending screenshots never outlive the window being dismissed, and the
      // microphone can't be opened while it's hidden (SECURITY.md §7).
      if (!visible) {
        captures.clear()
        microphone.disarm()
      }
    },
    onFocus: () => {
      const info = permissions.screenInfo()
      if (info.status !== lastScreenStatus) {
        lastScreenStatus = info.status
        win.send('permissions:screenChanged', info)
      }
    },
    log,
  })
  assistant = win
  let lastScreenStatus = permissions.screenStatus()

  const devUrl = process.env.ELECTRON_RENDERER_URL
  const annotations = new AnnotationService({
    preloadPath: join(__dirname, '../preload/overlay.js'),
    page:
      devUrl !== undefined && devUrl !== ''
        ? {
            kind: 'url',
            target: new URL('overlay/index.html', `${devUrl.replace(/\/$/, '')}/`).href,
          }
        : { kind: 'file', target: join(__dirname, '../renderer/overlay/index.html') },
    durationMs: () => store.get().annotationSeconds * 1000,
    onChange: (visible) => win.send('annotations:state', { visible }),
  })
  annotationService = annotations

  const captureService = new ScreenCaptureService({
    backend: fake?.backend ?? electronCaptureBackend(),
    screenPermission: () => permissions.screenStatus(),
    concealer: {
      conceal: () => {
        // Old annotations would end up in the new screenshot.
        annotations.clear()
        return win.concealForCapture()
      },
      activeDisplayId: () => win.activeDisplayId(),
    },
    store: captures,
    log,
  })

  const shortcutService = new ShortcutService(
    globalShortcut,
    () => win.toggle(),
    (status) => {
      win.send('shortcut:status', status)
      refreshTray()
      if (!status.registered) log('shortcut: registration failed')
    },
  )
  shortcuts = shortcutService

  const mock = new MockProvider()
  const ai = new AiService({
    config: () => store.get().ai,
    apiKey: () => secrets.getApiKey(),
    captures,
    providerFor: (config, apiKey) =>
      config.provider === 'mock'
        ? mock
        : // net.fetch uses Chromium's network stack, so system proxies and certificates apply.
          new OpenAiCompatibleProvider({ baseUrl: config.baseUrl, apiKey }, (url, init) =>
            net.fetch(url, init),
          ),
    emit: (event) => win.send('chat:event', event),
    history: { enabled: () => store.get().saveHistory, store: conversation },
    log,
    // Draw what the model pointed at, on the display its screenshot came from.
    onAnswer: ({ text, displayId }) => {
      if (displayId === null) return
      const items = parseAnnotations(text)
      if (items.length > 0) {
        void annotations.show(displayId, items).then((n) => log(`annotations: drew ${n}`))
      }
    },
  })

  const fetchViaNet = (url: string, init: RequestInit): Promise<Response> => net.fetch(url, init)
  const credentials = () => ({ ai: store.get().ai, apiKey: secrets.getApiKey() })
  // Slower in E2E so tests can see the live partial transcript.
  const mockStt = new MockTranscriptionProvider(isE2E ? 150 : 45)
  const stt = new SpeechToTextService({
    voice: () => store.get().voice,
    credentials,
    providerFor: (kind, c) => {
      const provider =
        kind === 'mock'
          ? mockStt
          : new OpenAiTranscriptionProvider(
              { baseUrl: c.ai.baseUrl, apiKey: c.apiKey },
              fetchViaNet,
            )
      return fakeVoice?.counted(provider) ?? provider
    },
    emit: (event) => win.send('voice:event', event),
    log,
  })
  const tts = new TextToSpeechService({
    voice: () => store.get().voice,
    credentials,
    fetch: fetchViaNet,
  })

  // The optional "start listening from anywhere" shortcut, off by default.
  const voiceShortcutService = new ShortcutService(
    globalShortcut,
    () => {
      win.show({ mode: 'expanded', focusInput: true })
      win.send('assistant:command', { command: 'toggleVoice' })
    },
    (status) => win.send('voiceShortcut:status', status),
  )
  voiceShortcuts = voiceShortcutService
  const applyVoiceShortcut = (): void => {
    const voice = store.get().voice
    if (voice.mode === 'voice' && voice.shortcutEnabled) {
      if (!voiceShortcutService.status().registered) voiceShortcutService.register(VOICE_SHORTCUT)
    } else {
      voiceShortcutService.unregister()
      win.send('voiceShortcut:status', { accelerator: VOICE_SHORTCUT, registered: false })
    }
  }

  registerIpcRouter(
    ipcMain,
    createHandlers({
      version: app.getVersion(),
      platform: process.platform,
      assistant: win,
      settings: store,
      shortcuts: shortcutService,
      capture: captureService,
      permissions,
      secrets,
      ai,
      stt,
      tts,
      microphone,
      applyVoiceShortcut,
      annotations,
      demoAnnotations: () => annotations.show(win.activeDisplayId(), DEMO_ANNOTATIONS),
      applyDockVisibility,
      quit: () => app.quit(),
      relaunch: () => {
        app.relaunch()
        app.quit()
      },
    }),
    {
      isTrustedSender: (event) =>
        win.ownsContents(event.sender) &&
        event.senderFrame !== null &&
        event.senderFrame.parent === null &&
        isAppUrl(event.senderFrame.url, location),
      validateResponses: !app.isPackaged,
      log,
    },
  )

  const showChat = (): void => win.show({ mode: 'expanded', focusInput: true })
  const trayService = new TrayService(trayIcon, {
    toggle: () => (win.isVisible() ? win.hide() : showChat()),
    newChat: () => {
      captures.clear()
      showChat()
      win.send('assistant:command', { command: 'newChat' })
    },
    openSettings: () => {
      showChat()
      win.send('assistant:command', { command: 'openSettings' })
    },
    quit: () => app.quit(),
  })
  tray = trayService

  app.on('second-instance', showChat)

  const ready = win.waitUntilReady()
  await win.load()
  await ready
  shortcutService.register(store.get().shortcut)
  applyVoiceShortcut()
  win.show({ mode: 'collapsed', focusInput: false })
  refreshTray()

  if (isE2E) {
    const { installTestHooks } = await import('./testing/testHooks')
    installTestHooks({
      assistant: win,
      shortcuts: shortcutService,
      tray: trayService,
      captures,
      fakeCapture: fake?.state ?? null,
      ai,
      fakeVoice: fakeVoice?.state ?? null,
      microphone,
      annotations,
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('before-quit', () => {
    isQuitting = true
  })
  // The assistant lives in the menu bar; closing its window never quits.
  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    shortcuts?.unregister()
    voiceShortcuts?.unregister()
    globalShortcut.unregisterAll()
    settings?.flushSync()
    captureStore?.clear()
    annotationService?.destroy()
    tray?.destroy()
    tray = null
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => app.quit())
  }

  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      log(`startup failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      app.exit(1)
    })
}
