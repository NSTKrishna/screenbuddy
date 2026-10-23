import { describe, expect, it } from 'vitest'
import { isScreenQuestion } from '../../../src/renderer/assistant/lib/screenIntent'

describe('isScreenQuestion', () => {
  it.each([
    "What's on my screen?",
    'what am I looking at',
    'Can you explain this page?',
    'What does the error in this dialog mean?',
    'Look at my screen and tell me what to do',
    'Summarise the current tab',
    'Where do I click to export?',
    'can you see this?',
    'take a screenshot and help me',
    'What’s this window for?', // curly apostrophe
  ])('treats %j as a screen question', (text) => {
    expect(isScreenQuestion(text)).toBe(true)
  })

  it.each([
    'hello',
    'What can you do?',
    'How do I take a screenshot on a Mac?',
    'how to capture screenshot',
    'screenshots on windows are weird',
    "Don't look at my screen",
    'Answer without a screenshot please: what is 2+2?',
    'What is a monitor lizard?',
    'Tell me about screen time research',
    '',
    '   ',
  ])('does not capture for %j', (text) => {
    expect(isScreenQuestion(text)).toBe(false)
  })
})
