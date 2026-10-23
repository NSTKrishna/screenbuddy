import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { assistantRendererLocation, isAppUrl } from '../../../src/main/security/rendererOrigin'
import { hardenedWebPreferences } from '../../../src/main/security/webPreferences'
import {
  ShortcutService,
  type GlobalShortcutLike,
} from '../../../src/main/services/ShortcutService'

describe('hardenedWebPreferences', () => {
  it('returns the hardened flags from ARCHITECTURE.md §3', () => {
    expect(hardenedWebPreferences('/app/preload.js')).toMatchObject({
      preload: '/app/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    })
  })
})

describe('renderer origin', () => {
  const dev = assistantRendererLocation('http://localhost:5173', '/app/out')
  const prod = assistantRendererLocation(undefined, '/app/out')

  it('resolves dev and production locations', () => {
    expect(dev).toEqual({ kind: 'url', target: 'http://localhost:5173/assistant/index.html' })
    expect(prod).toEqual({
      kind: 'file',
      target: join('/app/out', 'renderer', 'assistant', 'index.html'),
    })
  })

  it('accepts only the dev server origin in dev', () => {
    expect(isAppUrl('http://localhost:5173/assistant/index.html', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/assistant/index.html', dev)).toBe(false)
    expect(isAppUrl('https://example.com/', dev)).toBe(false)
  })

  it('accepts only the bundled page in production', () => {
    expect(isAppUrl('file:///app/out/renderer/assistant/index.html', prod)).toBe(true)
    expect(isAppUrl('file:///etc/passwd', prod)).toBe(false)
    expect(isAppUrl('https://example.com/', prod)).toBe(false)
  })

  it('rejects empty and malformed URLs', () => {
    expect(isAppUrl(undefined, prod)).toBe(false)
    expect(isAppUrl('', prod)).toBe(false)
    expect(isAppUrl('not a url', prod)).toBe(false)
  })
})

function fakeGlobalShortcut(behaviour: 'ok' | 'taken' | 'throws' = 'ok') {
  const registered = new Map<string, () => void>()
  const register = vi.fn((accelerator: string, cb: () => void) => {
    if (behaviour === 'throws') throw new Error('bad accelerator')
    if (behaviour === 'taken') return false
    registered.set(accelerator, cb)
    return true
  })
  const unregister = vi.fn((accelerator: string) => {
    registered.delete(accelerator)
  })
  const gs: GlobalShortcutLike = { register, unregister }
  return { gs, registered, unregister }
}

describe('ShortcutService', () => {
  it('registers the shortcut and calls back when it fires', () => {
    const { gs, registered } = fakeGlobalShortcut()
    const onTrigger = vi.fn()
    const onStatus = vi.fn()
    const service = new ShortcutService(gs, onTrigger, onStatus)
    expect(service.register('CommandOrControl+Shift+Space')).toEqual({
      accelerator: 'CommandOrControl+Shift+Space',
      registered: true,
    })
    registered.get('CommandOrControl+Shift+Space')?.()
    expect(onTrigger).toHaveBeenCalledOnce()
    expect(onStatus).toHaveBeenCalledWith({
      accelerator: 'CommandOrControl+Shift+Space',
      registered: true,
    })
  })

  it('reports a conflict instead of throwing', () => {
    const onStatus = vi.fn()
    const service = new ShortcutService(fakeGlobalShortcut('taken').gs, vi.fn(), onStatus)
    expect(service.register('CommandOrControl+Shift+Space').registered).toBe(false)
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ registered: false }))
  })

  it('reports a malformed accelerator instead of throwing', () => {
    const service = new ShortcutService(fakeGlobalShortcut('throws').gs, vi.fn())
    expect(service.register('Nope+Nope').registered).toBe(false)
  })

  it('unregisters the previous shortcut when re-registering, and on unregister', () => {
    const { gs, registered, unregister } = fakeGlobalShortcut()
    const service = new ShortcutService(gs, vi.fn())
    service.register('Alt+Shift+Space')
    service.register('CommandOrControl+Shift+Space')
    expect(unregister).toHaveBeenCalledWith('Alt+Shift+Space')
    service.unregister()
    expect(registered.size).toBe(0)
    expect(service.status().registered).toBe(false)
  })

  it('does not unregister a shortcut it never got', () => {
    const { gs, unregister } = fakeGlobalShortcut('taken')
    const service = new ShortcutService(gs, vi.fn())
    service.register('CommandOrControl+Shift+Space')
    service.unregister()
    expect(unregister).not.toHaveBeenCalled()
  })
})
