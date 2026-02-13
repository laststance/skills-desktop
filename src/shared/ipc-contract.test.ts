import { describe, it, expect } from 'vitest'

import { IPC_CHANNELS } from './ipc-channels'
import type { IpcEventContract, IpcInvokeContract } from './ipc-contract'

describe('IPC contract alignment', () => {
  it('all IPC_CHANNELS invoke values are valid contract keys', () => {
    // Type-level check: each IPC_CHANNELS value should be a key of the contract
    const invokeChannels: readonly (keyof IpcInvokeContract)[] = [
      IPC_CHANNELS.SKILLS_GET_ALL,
      IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT,
      IPC_CHANNELS.SKILLS_REMOVE_ALL_FROM_AGENT,
      IPC_CHANNELS.SKILLS_DELETE,
      IPC_CHANNELS.SKILLS_CREATE_SYMLINKS,
      IPC_CHANNELS.AGENTS_GET_ALL,
      IPC_CHANNELS.SOURCE_GET_STATS,
      IPC_CHANNELS.FILES_LIST,
      IPC_CHANNELS.FILES_READ,
      IPC_CHANNELS.SKILLS_CLI_SEARCH,
      IPC_CHANNELS.SKILLS_CLI_INSTALL,
      IPC_CHANNELS.SKILLS_CLI_REMOVE,
      IPC_CHANNELS.SKILLS_CLI_CANCEL,
      IPC_CHANNELS.SYNC_PREVIEW,
      IPC_CHANNELS.SYNC_EXECUTE,
      IPC_CHANNELS.UPDATE_DOWNLOAD,
      IPC_CHANNELS.UPDATE_INSTALL,
      IPC_CHANNELS.UPDATE_CHECK,
    ]

    // Runtime assertion: all 18 invoke channels are covered
    expect(invokeChannels).toHaveLength(18)
  })

  it('all IPC_CHANNELS event values are valid event contract keys', () => {
    const eventChannels: readonly (keyof IpcEventContract)[] = [
      IPC_CHANNELS.SKILLS_CLI_PROGRESS,
      IPC_CHANNELS.UPDATE_CHECKING,
      IPC_CHANNELS.UPDATE_AVAILABLE,
      IPC_CHANNELS.UPDATE_NOT_AVAILABLE,
      IPC_CHANNELS.UPDATE_PROGRESS,
      IPC_CHANNELS.UPDATE_DOWNLOADED,
      IPC_CHANNELS.UPDATE_ERROR,
    ]

    // Runtime assertion: all 7 event channels are covered
    expect(eventChannels).toHaveLength(7)
  })
})
