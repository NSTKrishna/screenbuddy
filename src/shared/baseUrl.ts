/** No imports, so renderers can validate inline without pulling in zod. */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string }

/**
 * An OpenAI-compatible base URL, such as `https://api.openai.com/v1`.
 * It must be https, except for local servers (Ollama, LM Studio), which may
 * use plain http (SECURITY.md §5, T8). Credentials, queries and fragments
 * are refused so nothing secret hides in the URL.
 */
export function checkBaseUrl(input: string): BaseUrlCheck {
  const raw = input.trim()
  if (raw === '') return { ok: false, reason: 'Enter the API base URL.' }
  if (raw.length > 500) return { ok: false, reason: 'That URL is too long.' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'That isn’t a valid URL.' }
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, reason: 'Use https://, or http:// only for localhost.' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'Don’t put credentials in the URL; use the API key field.' }
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, reason: 'Remove the ? or # part of the URL.' }
  }
  return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` }
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}
