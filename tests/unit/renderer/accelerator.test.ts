import { describe, expect, it } from 'vitest'
import { acceleratorKeys } from '../../../src/renderer/assistant/lib/accelerator'

describe('acceleratorKeys', () => {
  it('renders macOS symbols', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+Space', 'darwin')).toEqual(['⌘', '⇧', 'Space'])
    expect(acceleratorKeys('Alt+Ctrl+k', 'darwin')).toEqual(['⌥', '⌃', 'K'])
  })

  it('renders names elsewhere', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+Space', 'win32')).toEqual([
      'Ctrl',
      'Shift',
      'Space',
    ])
  })
})
