import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Where the assistant UI is loaded from: the Vite dev server in development,
 * the bundled file in production. Anything else is not "the app".
 */
export interface RendererLocation {
  readonly kind: 'url' | 'file'
  readonly target: string
}

export function assistantRendererLocation(
  devServerUrl: string | undefined,
  outDir: string,
): RendererLocation {
  if (devServerUrl !== undefined && devServerUrl !== '') {
    return { kind: 'url', target: new URL('assistant/index.html', ensureSlash(devServerUrl)).href }
  }
  return { kind: 'file', target: join(outDir, 'renderer', 'assistant', 'index.html') }
}

/** True when `url` is a page this app serves itself. */
export function isAppUrl(url: string | undefined, location: RendererLocation): boolean {
  if (url === undefined || url === '') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (location.kind === 'url') {
    return parsed.origin === new URL(location.target).origin
  }
  const expected = pathToFileURL(location.target)
  return parsed.protocol === 'file:' && parsed.pathname === expected.pathname
}

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
