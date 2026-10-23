import { app, session, type WebContents } from 'electron'
import type { MicrophoneGate } from './microphoneGate'
import { isAppUrl, type RendererLocation } from './rendererOrigin'

/**
 * Process-wide guards from SECURITY.md §3:
 * - no navigation away from the app, no new windows, no <webview>;
 * - every permission request and check is denied, except clipboard writes
 *   from the app's own page, and audio-only microphone access while the user
 *   is recording (MicrophoneGate).
 */
export function installSecurityGuards(
  location: RendererLocation,
  microphone: MicrophoneGate,
): void {
  app.on('web-contents-created', (_event, contents) => {
    guardContents(contents, location)
  })

  // Exceptions, all for the app's own page only:
  // - clipboard *writes*, for the Copy button on code blocks (reads stay denied);
  // - the microphone, audio only, while a user-started recording is armed.
  const allowed = (
    permission: string,
    url: string | undefined,
    media: readonly string[],
  ): boolean => {
    if (!isAppUrl(url, location)) return false
    if (permission === 'clipboard-sanitized-write') return true
    if (permission === 'media') {
      return microphone.isArmed() && media.length > 0 && media.every((m) => m === 'audio')
    }
    return false
  }

  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const media = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(allowed(permission, details.requestingUrl, media))
  })
  ses.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    allowed(
      permission,
      details.requestingUrl,
      details.mediaType === undefined ? [] : [details.mediaType],
    ),
  )
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    // An empty response denies the request.
    callback({})
  })
}

function guardContents(contents: WebContents, location: RendererLocation): void {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, location)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, location)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
