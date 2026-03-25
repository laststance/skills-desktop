import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'

import type {
  IpcInvokeChannel,
  IpcInvokeContract,
} from '../../shared/ipc-contract'

import { IPC_ARG_SCHEMAS } from './ipc-schemas'

/**
 * Type-safe wrapper around ipcMain.handle that enforces the IPC contract
 * with runtime Zod validation. Args are validated against IPC_ARG_SCHEMAS
 * before the handler is called. Parsed (coerced) args are forwarded to the handler.
 * @param channel - IPC channel name (must be a key of IpcInvokeContract)
 * @param handler - Handler function receiving (event, ...args) and returning the contracted result
 * @throws Error with descriptive message if args fail Zod validation
 * @example
 * typedHandle('skills:getAll', async () => scanSkills())
 * typedHandle('files:list', async (_, skillPath) => listSkillFiles(skillPath))
 */
export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeContract[C]['args']
  ) => Promise<IpcInvokeContract[C]['result']> | IpcInvokeContract[C]['result'],
): void {
  ipcMain.handle(channel, async (event, ...rawArgs) => {
    const schema = IPC_ARG_SCHEMAS[channel]
    let args: unknown[] = rawArgs
    if (schema) {
      try {
        args = schema.parse(rawArgs) as unknown[]
      } catch (error) {
        if (error instanceof ZodError) {
          throw new Error(
            `IPC validation failed on '${channel}': ${error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
          )
        }
        throw error
      }
    }

    return (
      handler as (
        event: IpcMainInvokeEvent,
        ...args: unknown[]
      ) => Promise<unknown>
    )(event, ...args)
  })
}
