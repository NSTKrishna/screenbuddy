import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const VALID_KEY = 'sk-e2e-valid-key-0001'
/** Requests with images to this model are refused, like a real text-only model. */
export const TEXT_ONLY_MODEL = 'text-only-model'

interface WireMessage {
  role: string
  content: string | { type: string; text?: string; image_url?: { url: string } }[]
}

export interface RecordedRequest {
  authorization: string | undefined
  body: { model: string; stream: boolean; messages: WireMessage[] }
}

export function hasImage(request: RecordedRequest): boolean {
  return request.body.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  )
}

export function textOf(message: WireMessage | undefined): string {
  if (message === undefined) return ''
  if (typeof message.content === 'string') return message.content
  return message.content.map((p) => p.text ?? '').join('')
}

/**
 * A tiny OpenAI-compatible server for E2E (IMPLEMENTATION_PLAN: "fake AI
 * provider"). It streams real SSE so the app's actual provider code runs.
 */
export async function startMockOpenAi(options: { wordDelayMs?: number } = {}) {
  const requests: RecordedRequest[] = []
  let aborted = 0
  let wordDelayMs = options.wordDelayMs ?? 15

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(raw) as RecordedRequest['body']
      const request = { authorization: req.headers.authorization, body }
      requests.push(request)

      const json = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
      }
      if (request.authorization !== `Bearer ${VALID_KEY}`) {
        json(401, { error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } })
        return
      }
      if (body.model === TEXT_ONLY_MODEL && hasImage(request)) {
        json(400, {
          error: {
            message: 'Invalid content type. image_url is only supported by certain models.',
          },
        })
        return
      }

      const question = textOf(body.messages.at(-1))
      const answer = `**Answer** to: ${question}. ${hasImage(request) ? 'I can see the screenshot. ' : ''}Step one, then step two.`
      // "Where…" questions with a screenshot get an annotations block, like a real model might.
      const pointed =
        hasImage(request) && /^where/i.test(question)
          ? `${answer}\n\n\`\`\`annotations\n[{"type":"circle","x":0.25,"y":0.5,"label":"Here"}]\n\`\`\``
          : answer
      const words = pointed.match(/\S+\s*/g) ?? []
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      let closed = false
      res.on('close', () => {
        if (!res.writableEnded) {
          closed = true
          aborted += 1
        }
      })
      let i = 0
      const next = (): void => {
        if (closed) return
        const word = words[i++]
        if (word === undefined) {
          res.end('data: [DONE]\n\n')
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`)
        setTimeout(next, wordDelayMs)
      }
      next()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    aborted: () => aborted,
    setWordDelay: (ms: number) => {
      wordDelayMs = ms
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** A local port with nothing listening, for "provider unavailable". */
export async function closedPort(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `http://127.0.0.1:${port}/v1`
}
