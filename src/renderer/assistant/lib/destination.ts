import type { PublicSettings } from '@shared/schemas/settings'

export interface Destination {
  mock: boolean
  /** The provider's host, e.g. "api.openai.com", shown wherever data could leave the Mac. */
  host: string
  model: string
  canSeeImages: boolean
}

export function destinationOf(settings: PublicSettings | null): Destination {
  const ai = settings?.ai
  if (ai === undefined || ai.provider === 'mock') {
    return { mock: true, host: '', model: 'Mock mode', canSeeImages: true }
  }
  let host = ai.baseUrl
  try {
    host = new URL(ai.baseUrl).host
  } catch {
    // Leave the raw value; settings validation makes this unreachable.
  }
  return { mock: false, host, model: ai.model, canSeeImages: ai.supportsVision }
}

/** The sentence that says where a pending image goes. */
export function imagePrivacyNote(d: Destination): string {
  if (d.mock) return 'Stays on this Mac. Mock mode never uploads anything.'
  if (!d.canSeeImages) return 'Your model is set as text-only, so this image won’t be sent.'
  return `Not sent yet. Sending shares this image with ${d.host}.`
}
