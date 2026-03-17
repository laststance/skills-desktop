import { describe, it, expect } from 'vitest'

import { IPC_CHANNELS } from './ipc-channels'
import type { IpcEventContract, IpcInvokeContract } from './ipc-contract'

describe('IPC contract alignment', () => {
  it('all IPC_CHANNELS invoke values are valid contract keys', () => {
    // Exhaustive compile-time check: missing or extra keys fail compilation
    const invokeMapping = {
      [IPC_CHANNELS.SKILLS_GET_ALL]: true,
      [IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT]: true,
      [IPC_CHANNELS.SKILLS_REMOVE_ALL_FROM_AGENT]: true,
      [IPC_CHANNELS.SKILLS_DELETE]: true,
      [IPC_CHANNELS.SKILLS_CREATE_SYMLINKS]: true,
      [IPC_CHANNELS.SKILLS_COPY_TO_AGENTS]: true,
      [IPC_CHANNELS.AGENTS_GET_ALL]: true,
      [IPC_CHANNELS.SOURCE_GET_STATS]: true,
      [IPC_CHANNELS.FILES_LIST]: true,
      [IPC_CHANNELS.FILES_READ]: true,
      [IPC_CHANNELS.SKILLS_CLI_SEARCH]: true,
      [IPC_CHANNELS.SKILLS_CLI_INSTALL]: true,
      [IPC_CHANNELS.SKILLS_CLI_REMOVE]: true,
      [IPC_CHANNELS.SKILLS_CLI_CANCEL]: true,
      [IPC_CHANNELS.SYNC_PREVIEW]: true,
      [IPC_CHANNELS.SYNC_EXECUTE]: true,
      [IPC_CHANNELS.UPDATE_DOWNLOAD]: true,
      [IPC_CHANNELS.UPDATE_INSTALL]: true,
      [IPC_CHANNELS.UPDATE_CHECK]: true,
    } as const satisfies Record<keyof IpcInvokeContract, true>

    // Runtime assertion: mapping covers exactly the contract keys
    expect(Object.keys(invokeMapping)).toHaveLength(19)
  })

  it('all IPC_CHANNELS event values are valid event contract keys', () => {
    // Exhaustive compile-time check: missing or extra keys fail compilation
    const eventMapping = {
      [IPC_CHANNELS.SKILLS_CLI_PROGRESS]: true,
      [IPC_CHANNELS.UPDATE_CHECKING]: true,
      [IPC_CHANNELS.UPDATE_AVAILABLE]: true,
      [IPC_CHANNELS.UPDATE_NOT_AVAILABLE]: true,
      [IPC_CHANNELS.UPDATE_PROGRESS]: true,
      [IPC_CHANNELS.UPDATE_DOWNLOADED]: true,
      [IPC_CHANNELS.UPDATE_ERROR]: true,
    } as const satisfies Record<keyof IpcEventContract, true>

    // Runtime assertion: mapping covers exactly the contract keys
    expect(Object.keys(eventMapping)).toHaveLength(7)
  })
})
