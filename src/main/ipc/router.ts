import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import {
  ipcContract,
  type Channel,
  type IpcContract,
  type IpcErrorCode,
  type IpcResponse,
  type IpcResult,
} from '@shared/ipc/contract'

export type Handlers = {
  [C in Channel]: (
    req: z.output<IpcContract[C]['req']>,
    event: IpcMainInvokeEvent,
  ) => IpcResponse<C> | Promise<IpcResponse<C>>
}

/** The slice of `ipcMain` the router needs; tests pass a fake. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
  ): void
  removeHandler: (channel: string) => void
}

export interface RouterOptions {
  /** Sender check: the frame must be ours and the window allowed on this channel. */
  isTrustedSender: (event: IpcMainInvokeEvent, channel: Channel) => boolean
  /** Validate responses too. On in dev and test, off in packaged builds. */
  validateResponses: boolean
  log?: (message: string) => void
}

function fail(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

/**
 * Registers one `ipcMain.handle` per contract channel. Each call is checked
 * (sender, then payload) before the handler runs; failures are returned as a
 * `{ code, message }` envelope with no stack trace or payload echo.
 */
export function registerIpcRouter(
  ipcMain: IpcMainLike,
  handlers: Handlers,
  options: RouterOptions,
): () => void {
  const channels = Object.keys(ipcContract) as Channel[]
  const log = options.log ?? (() => undefined)

  for (const channel of channels) {
    const schema = ipcContract[channel]
    const handler = handlers[channel] as (req: unknown, event: IpcMainInvokeEvent) => unknown

    ipcMain.handle(channel, async (event, payload) => {
      if (!options.isTrustedSender(event, channel)) {
        log(`ipc: rejected untrusted sender on ${channel}`)
        return fail('FORBIDDEN', 'Request not allowed.')
      }
      const parsed = schema.req.safeParse(payload)
      if (!parsed.success) {
        log(`ipc: invalid payload on ${channel}`)
        return fail('INVALID_REQUEST', 'Invalid request.')
      }
      try {
        const data = await handler(parsed.data, event)
        if (options.validateResponses) {
          const checked = schema.res.safeParse(data)
          if (!checked.success) {
            log(`ipc: response drift on ${channel}`)
            return fail('INTERNAL', 'Something went wrong.')
          }
        }
        return { ok: true, data } satisfies IpcResult<unknown>
      } catch (error) {
        log(
          `ipc: handler for ${channel} failed: ${error instanceof Error ? error.name : 'unknown'}`,
        )
        return fail('INTERNAL', 'Something went wrong.')
      }
    })
  }

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
