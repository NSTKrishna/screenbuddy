import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ScreenBuddyApi } from '@shared/bridge'
import type { Channel, IpcRequest, IpcResponse, IpcResult } from '@shared/ipc/contract'
import type { EventName, EventPayload } from '@shared/ipc/events'

// Only type imports from shared: this file runs sandboxed and must stay tiny.

class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

async function invoke<C extends Channel>(channel: C, req?: IpcRequest<C>): Promise<IpcResponse<C>> {
  const result = (await ipcRenderer.invoke(channel, req)) as IpcResult<IpcResponse<C>>
  if (result.ok) return result.data
  throw new BridgeError(result.error.code, result.error.message)
}

function subscribe<E extends EventName>(
  event: E,
  cb: (payload: EventPayload<E>) => void,
): () => void {
  // Never hand the IpcRendererEvent (and its `sender`) to the page.
  const listener = (_e: IpcRendererEvent, payload: EventPayload<E>): void => cb(payload)
  ipcRenderer.on(event, listener)
  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

const api: ScreenBuddyApi = {
  app: {
    getInfo: () => invoke('app:getInfo'),
    quit: () => invoke('app:quit'),
    relaunch: () => invoke('app:relaunch'),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
  },
  window: {
    setMode: (mode) => invoke('window:setMode', { mode }),
    hide: () => invoke('window:hide'),
    resetPosition: () => invoke('window:resetPosition'),
    dragStart: () => invoke('window:dragStart'),
    dragMove: () => invoke('window:dragMove'),
    dragEnd: () => invoke('window:dragEnd'),
  },
  capture: {
    listDisplays: () => invoke('capture:listDisplays'),
    take: (request) => invoke('capture:take', request),
    cancel: () => invoke('capture:cancel'),
    importImage: (request) => invoke('capture:importImage', request),
    discard: (captureId) => invoke('capture:discard', { captureId }),
  },
  secrets: {
    setApiKey: (apiKey) => invoke('secrets:setApiKey', { apiKey }),
    clearApiKey: () => invoke('secrets:clearApiKey'),
  },
  ai: {
    testConnection: () => invoke('ai:testConnection'),
  },
  chat: {
    send: (request) => invoke('chat:send', request),
    retry: (request) => invoke('chat:retry', request),
    cancel: (turnId) => invoke('chat:cancel', { turnId }),
    reset: () => invoke('chat:reset'),
    history: () => invoke('chat:history'),
  },
  annotations: {
    demo: () => invoke('annotations:demo'),
    clear: () => invoke('annotations:clear'),
  },
  permissions: {
    getScreen: () => invoke('permissions:getScreen'),
    openScreenSettings: () => invoke('permissions:openScreenSettings'),
    getMicrophone: () => invoke('permissions:getMicrophone'),
    openMicrophoneSettings: () => invoke('permissions:openMicrophoneSettings'),
  },
  voice: {
    begin: () => invoke('voice:begin'),
    end: () => invoke('voice:end'),
    transcribe: (request) => invoke('voice:transcribe', request),
    cancelTranscription: (requestId) => invoke('voice:cancelTranscription', { requestId }),
    speak: (text) => invoke('voice:speak', { text }),
  },
  events: {
    onVisibility: (cb) => subscribe('assistant:visibility', cb),
    onCommand: (cb) => subscribe('assistant:command', cb),
    onShortcutStatus: (cb) => subscribe('shortcut:status', cb),
    onChatEvent: (cb) => subscribe('chat:event', cb),
    onVoiceEvent: (cb) => subscribe('voice:event', cb),
    onAnnotationState: (cb) => subscribe('annotations:state', cb),
    onVoiceShortcutStatus: (cb) => subscribe('voiceShortcut:status', cb),
    onScreenPermission: (cb) => subscribe('permissions:screenChanged', cb),
  },
}

contextBridge.exposeInMainWorld('screenBuddy', api)
