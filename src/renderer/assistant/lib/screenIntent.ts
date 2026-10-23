/**
 * Decides whether a message is clearly about what is on the user's screen,
 * so a capture can be offered for review. It errs on the side of *not*
 * capturing: it needs an explicit reference to the screen, and it backs off
 * for negations and for questions about screenshots in general.
 */

const SCREEN_NOUN = '(?:screen|display|monitor|desktop|window|page|tab|dialog|pop-?up)'

const ASKS_ABOUT_SCREEN: RegExp[] = [
  // "on my screen", "at this window", "in the current tab"
  new RegExp(`\\b(?:on|in|at|of) (?:my|the|this|current|the current) ${SCREEN_NOUN}\\b`),
  // "this page", "my screen", "the current window"
  new RegExp(`\\b(?:my|this|the current) ${SCREEN_NOUN}\\b`),
  // "what am I looking at", "what's this I'm seeing"
  /\bwhat(?:'s| is| am i)?(?: this)?(?: i'm| i am)? (?:looking at|seeing)\b/,
  // "can you see this", "can you see it"
  /\bcan you see (?:this|that|it|what)\b/,
  // "where do I click", "where should I click"
  /\bwhere (?:do|should|can) i (?:click|tap|press)\b/,
  // "take a screenshot", "use a screenshot", "here's a screenshot"
  /\b(?:take|grab|capture|use|send|attach)(?: a| the)? screenshot\b/,
]

const BACK_OFF: RegExp[] = [
  // "don't look at my screen", "without a screenshot"
  /\b(?:don't|do not|never|no|without|stop)\b[^.?!]{0,24}\b(?:screen|screenshot|look|capture|see)/,
  // General how-to questions about screenshots, not requests for one.
  /\bhow (?:do|can|to|would)(?: i| you)? (?:take|make|capture|grab)(?: a)? screenshot/,
  /\bscreenshots? (?:on|in|with) (?:a )?(?:mac|macos|windows|iphone|linux)\b/,
]

export function isScreenQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
  if (t === '') return false
  if (BACK_OFF.some((r) => r.test(t))) return false
  return ASKS_ABOUT_SCREEN.some((r) => r.test(t))
}
