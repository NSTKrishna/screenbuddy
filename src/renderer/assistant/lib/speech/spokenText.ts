/**
 * Turns a Markdown answer into something pleasant to listen to. Code and
 * tables are mentioned rather than read out, formatting marks are dropped,
 * and long answers are cut at a sentence boundary (the full text is on screen).
 */
export function spokenText(markdown: string, maxChars = 900): string {
  // The annotations block is for the overlay; never read it out.
  let text = markdown.replace(/```annotations[\s\S]*?(```|$)/gi, ' ')
  let mentionedCode = false
  text = text.replace(/```[\s\S]*?(```|$)/g, () => {
    if (mentionedCode) return ' '
    mentionedCode = true
    return ' There’s a code snippet in the chat. '
  })
  let mentionedTable = false
  text = text.replace(/(^\|.*\|\s*$\n?)+/gm, () => {
    if (mentionedTable) return ' '
    mentionedTable = true
    return ' There’s a table in the chat. '
  })
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^\s*>\s?/gm, '') // quotes
    .replace(/^\s*[-*+]\s+/gm, '') // bullets
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)(?<=\S)\1/g, '$2') // emphasis
    .replace(/<[^>]+>/g, '') // stray HTML
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  const head = end > maxChars * 0.4 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
  return `${head} The rest is in the chat.`
}

/**
 * Splits text into utterance-sized pieces. macOS system voices can stall on
 * very long utterances, and short pieces make Stop respond at once.
 */
export function sentences(text: string, maxLength = 220): string[] {
  const pieces = text.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? []
  const out: string[] = []
  for (const raw of pieces) {
    let piece = raw.trim()
    while (piece.length > maxLength) {
      const at = piece.lastIndexOf(' ', maxLength)
      const split = at > maxLength / 2 ? at : maxLength
      out.push(piece.slice(0, split).trim())
      piece = piece.slice(split).trim()
    }
    if (piece !== '') out.push(piece)
  }
  return out
}
