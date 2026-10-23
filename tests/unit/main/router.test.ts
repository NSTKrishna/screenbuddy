import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ipcContract, type Channel } from '@shared/ipc/contract'
import { VoiceSettings } from '@shared/schemas/voice'
import { registerIpcRouter, type Handlers, type IpcMainLike } from '../../../src/main/ipc/router'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

function fakeIpcMain(): IpcMainLike & {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
} {
  const listeners = new Map<string, Listener>()
  return {
    handle: (channel, listener) => listeners.set(channel, listener),
    removeHandler: (channel) => listeners.delete(channel),
    invoke: (channel, payload) => {
      const listener = listeners.get(channel)
      if (listener === undefined) throw new Error(`no handler for ${channel}`)
      return listener({} as IpcMainInvokeEvent, payload)
    },
  }
}

function handlers(overrides: Partial<Handlers> = {}): Handlers {
  const info = {
    version: '0.1.0',
    platform: 'darwin',
    shortcut: { accelerator: 'CommandOrControl+Shift+Space', registered: true },
    mode: 'collapsed' as const,
  }
  const mic = { status: 'granted' as const, grantee: 'Electron', canOpenSettings: true }
  const settings = {
    shortcut: 'CommandOrControl+Shift+Space',
    showDockIcon: false,
    autoCaptureScreenQuestions: true,
    ai: {
      provider: 'mock' as const,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      supportsVision: true,
    },
    saveHistory: false,
    annotationSeconds: 8,
    voice: VoiceSettings.parse({}),
    apiKey: { present: false, hint: null, storage: 'none' as const },
  }
  return {
    'app:getInfo': () => info,
    'app:quit': () => undefined,
    'app:relaunch': () => undefined,
    'settings:get': () => settings,
    'settings:update': (patch) => ({
      ...settings,
      showDockIcon: patch.showDockIcon ?? settings.showDockIcon,
    }),
    'secrets:setApiKey': () => settings,
    'secrets:clearApiKey': () => settings,
    'ai:testConnection': () => ({ ok: true, message: 'ok', code: null }),
    'chat:send': () => ({ accepted: true as const }),
    'chat:retry': () => ({ accepted: true as const }),
    'chat:cancel': () => undefined,
    'chat:reset': () => undefined,
    'chat:history': () => ({ messages: [] }),
    'permissions:getMicrophone': () => mic,
    'permissions:openMicrophoneSettings': () => undefined,
    'voice:begin': () => mic,
    'voice:end': () => undefined,
    'voice:transcribe': () => ({ status: 'ok' as const, text: 'hi' }),
    'voice:cancelTranscription': () => undefined,
    'annotations:demo': () => ({ shown: 3 }),
    'annotations:clear': () => undefined,
    'voice:speak': () => ({
      status: 'failed' as const,
      error: { code: 'NOT_CONFIGURED' as const, message: 'x', retryable: false },
    }),
    'window:setMode': () => undefined,
    'window:hide': () => undefined,
    'window:resetPosition': () => undefined,
    'window:dragStart': () => undefined,
    'window:dragMove': () => undefined,
    'window:dragEnd': () => undefined,
    'capture:listDisplays': () => [],
    'capture:take': () => ({
      status: 'failed' as const,
      failure: { code: 'NO_DISPLAYS' as const, message: 'none' },
    }),
    'capture:cancel': () => undefined,
    'capture:importImage': () => ({
      status: 'failed' as const,
      failure: { code: 'INVALID_IMAGE' as const, message: 'bad' },
    }),
    'capture:discard': () => undefined,
    'permissions:getScreen': () => ({
      status: 'granted' as const,
      grantee: 'Electron',
      canOpenSettings: true,
    }),
    'permissions:openScreenSettings': () => undefined,
    ...overrides,
  }
}

const trusted = { isTrustedSender: () => true, validateResponses: true }

describe('registerIpcRouter', () => {
  it('registers exactly the contract channels', () => {
    const ipc = fakeIpcMain()
    const handle = vi.spyOn(ipc, 'handle')
    registerIpcRouter(ipc, handlers(), trusted)
    expect(handle.mock.calls.map(([c]) => c).sort()).toEqual(Object.keys(ipcContract).sort())
  })

  it('wraps successful responses in an ok envelope', async () => {
    const ipc = fakeIpcMain()
    registerIpcRouter(ipc, handlers(), trusted)
    await expect(ipc.invoke('settings:get')).resolves.toEqual({
      ok: true,
      data: expect.objectContaining({
        shortcut: 'CommandOrControl+Shift+Space',
        showDockIcon: false,
        apiKey: { present: false, hint: null, storage: 'none' },
      }) as unknown,
    })
  })

  it('rejects untrusted senders before running the handler', async () => {
    const ipc = fakeIpcMain()
    const hide = vi.fn()
    const isTrustedSender = vi.fn<(event: IpcMainInvokeEvent, channel: Channel) => boolean>(
      () => false,
    )
    registerIpcRouter(ipc, handlers({ 'window:hide': hide }), { ...trusted, isTrustedSender })
    await expect(ipc.invoke('window:hide')).resolves.toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Request not allowed.' },
    })
    expect(hide).not.toHaveBeenCalled()
    expect(isTrustedSender).toHaveBeenCalledWith(expect.anything(), 'window:hide')
  })

  it.each([
    ['window:setMode', { mode: 'fullscreen' }],
    ['window:setMode', { mode: 'expanded', extra: true }],
    ['settings:update', { showDockIcon: 'yes' }],
    ['settings:update', { shortcut: 'Alt+X' }],
    ['window:hide', { unexpected: 1 }],
    ['capture:take', { target: { kind: 'everything' }, reason: 'button' }],
    ['capture:take', { target: { kind: 'active' }, reason: 'timer' }],
    ['capture:take', { target: { kind: 'display', displayId: 1.5 }, reason: 'button' }],
    ['capture:discard', { captureId: '../../etc/passwd' }],
    ['capture:importImage', { name: 'x.png', bytes: 'iVBORw0KGgo=' }],
    ['capture:importImage', { name: 'x.png', bytes: new Uint8Array(0) }],
    ['settings:update', { ai: { baseUrl: 'http://evil.example.com/v1' } }],
    ['settings:update', { ai: { baseUrl: 'https://user:pass@api.example.com' } }],
    ['settings:update', { ai: { model: 'has spaces' } }],
    ['settings:update', { ai: { provider: 'anthropic-direct' } }],
    ['settings:update', { ai: { apiKey: 'sk-123' } }],
    ['secrets:setApiKey', { apiKey: '' }],
    ['secrets:setApiKey', { apiKey: 'two words' }],
    ['chat:send', { turnId: 'not-a-uuid', text: 'hi', captureId: null }],
    [
      'voice:transcribe',
      {
        requestId: '00000000-0000-4000-8000-000000000001',
        mimeType: 'audio/mpeg',
        bytes: new Uint8Array(4),
        durationMs: 100,
      },
    ],
    [
      'voice:transcribe',
      {
        requestId: '00000000-0000-4000-8000-000000000001',
        mimeType: 'audio/webm',
        bytes: new Uint8Array(0),
        durationMs: 100,
      },
    ],
    [
      'voice:transcribe',
      {
        requestId: '00000000-0000-4000-8000-000000000001',
        mimeType: 'audio/webm',
        bytes: 'UklGRg==',
        durationMs: 100,
      },
    ],
    ['voice:speak', { text: '' }],
    ['voice:speak', { text: 'x'.repeat(5000) }],
    ['settings:update', { voice: { mode: 'always-listening' } }],
    ['settings:update', { voice: { volume: 3 } }],
    ['settings:update', { voice: { transcription: { language: 'english' } } }],
    [
      'chat:send',
      { turnId: '00000000-0000-4000-8000-000000000001', text: 'x'.repeat(4001), captureId: null },
    ],
    [
      'chat:send',
      { turnId: '00000000-0000-4000-8000-000000000001', text: 'hi', image: 'data:...' },
    ],
  ])('rejects an invalid %s payload', async (channel, payload) => {
    const ipc = fakeIpcMain()
    registerIpcRouter(ipc, handlers(), trusted)
    await expect(ipc.invoke(channel, payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    })
  })

  it('passes the parsed payload to the handler', async () => {
    const ipc = fakeIpcMain()
    const setMode = vi.fn()
    registerIpcRouter(ipc, handlers({ 'window:setMode': setMode }), trusted)
    await ipc.invoke('window:setMode', { mode: 'expanded' })
    expect(setMode).toHaveBeenCalledWith({ mode: 'expanded' }, expect.anything())
  })

  it('hides handler errors behind a generic message', async () => {
    const ipc = fakeIpcMain()
    const log = vi.fn()
    registerIpcRouter(
      ipc,
      handlers({
        'window:hide': () => {
          throw new Error('secret detail /Users/someone/path')
        },
      }),
      { ...trusted, log },
    )
    const result = await ipc.invoke('window:hide')
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail')
  })

  it('catches response drift when validation is on', async () => {
    const ipc = fakeIpcMain()
    const drifting = handlers({
      'settings:get': () => ({ shortcut: 42 }) as unknown as ReturnType<Handlers['settings:get']>,
    })
    registerIpcRouter(ipc, drifting, trusted)
    await expect(ipc.invoke('settings:get')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    })
  })

  it('unregisters every channel on dispose', () => {
    const ipc = fakeIpcMain()
    const remove = vi.spyOn(ipc, 'removeHandler')
    const dispose = registerIpcRouter(ipc, handlers(), trusted)
    dispose()
    expect(remove).toHaveBeenCalledTimes(Object.keys(ipcContract).length)
  })
})
