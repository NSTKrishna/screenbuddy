/**
 * Incremental parser for `text/event-stream`. Feed it text as it arrives and
 * it returns the `data` payload of each complete event. Network chunks don't
 * line up with event boundaries, so partial lines are buffered.
 */
export class SseParser {
  private buffer = ''
  private data: string[] = []

  push(chunk: string): string[] {
    this.buffer += chunk
    const events: string[] = []
    let newline: number
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) !== -1) {
      // A trailing \r may be the first half of a \r\n split across chunks.
      if (newline === this.buffer.length - 1 && this.buffer.endsWith('\r')) break
      const line = this.buffer.slice(0, newline)
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1
      this.buffer = this.buffer.slice(newline + width)
      this.line(line, events)
    }
    return events
  }

  /** Call at end of stream: a final event without a trailing blank line still counts. */
  flush(): string[] {
    const events: string[] = []
    if (this.buffer !== '') this.line(this.buffer.replace(/\r$/, ''), events)
    this.buffer = ''
    this.line('', events)
    return events
  }

  private line(line: string, events: string[]): void {
    if (line === '') {
      if (this.data.length > 0) events.push(this.data.join('\n'))
      this.data = []
      return
    }
    if (line.startsWith(':')) return // comment / keep-alive
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== 'data') return
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    this.data.push(value)
  }
}
