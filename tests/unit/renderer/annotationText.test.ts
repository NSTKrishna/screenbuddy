import { describe, expect, it } from 'vitest'
import { withoutAnnotations } from '../../../src/renderer/assistant/components/ChatMessage'
import { spokenText } from '../../../src/renderer/assistant/lib/speech/spokenText'

describe('the annotations block', () => {
  it('is hidden from the chat bubble, even half-streamed', () => {
    expect(withoutAnnotations('Answer.\n\n```annotations\n[{"type":"arrow"')).toBe('Answer.')
    expect(withoutAnnotations('Answer.\n```annotations\n[]\n```')).toBe('Answer.')
    expect(withoutAnnotations('```ts\ncode\n```')).toBe('```ts\ncode\n```')
  })

  it('is never read aloud', () => {
    expect(
      spokenText('Click Save.\n\n```annotations\n[{"type":"circle","x":0.4,"y":0.2}]\n```'),
    ).toBe('Click Save.')
  })
})
