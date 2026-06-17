import { describe, it, expect } from 'vitest'

import { IPC_CHANNELS } from './ipc-channels'
import type { IpcEventContract, IpcInvokeContract } from './ipc-contract'

describe('IPC contract alignment', () => {
  it('forces a security review by tripping when an invoke channel is added or removed', () => {
    // Exhaustive compile-time check: missing or extra keys fail compilation
    // Arrange
    const invokeMapping = {
      [IPC_CHANNELS.SKILLS_GET_ALL]: true,
      [IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT]: true,
      [IPC_CHANNELS.SKILLS_REMOVE_ALL_FROM_AGENT]: true,
      [IPC_CHANNELS.SKILLS_DELETE]: true,
      [IPC_CHANNELS.SKILLS_CREATE_SYMLINKS]: true,
      [IPC_CHANNELS.SKILLS_COPY_TO_AGENTS]: true,
      [IPC_CHANNELS.SKILLS_DELETE_BATCH]: true,
      [IPC_CHANNELS.SKILLS_CLEAR_ORPHAN_SYMLINKS]: true,
      [IPC_CHANNELS.SKILLS_CLEAR_BROKEN_SYMLINK_SLOTS]: true,
      [IPC_CHANNELS.SKILLS_UNLINK_MANY_FROM_AGENT]: true,
      [IPC_CHANNELS.SKILLS_RESTORE_DELETED]: true,
      [IPC_CHANNELS.AGENTS_GET_ALL]: true,
      [IPC_CHANNELS.SOURCE_GET_STATS]: true,
      [IPC_CHANNELS.FILES_LIST]: true,
      [IPC_CHANNELS.FILES_READ]: true,
      [IPC_CHANNELS.FILES_READ_BINARY]: true,
      [IPC_CHANNELS.SKILLS_CLI_SEARCH]: true,
      [IPC_CHANNELS.SKILLS_CLI_INSTALL]: true,
      [IPC_CHANNELS.SKILLS_CLI_CANCEL]: true,
      [IPC_CHANNELS.MARKETPLACE_LEADERBOARD]: true,
      [IPC_CHANNELS.SYNC_PREVIEW]: true,
      [IPC_CHANNELS.SYNC_EXECUTE]: true,
      [IPC_CHANNELS.UPDATE_DOWNLOAD]: true,
      [IPC_CHANNELS.UPDATE_INSTALL]: true,
      [IPC_CHANNELS.UPDATE_CHECK]: true,
      [IPC_CHANNELS.SHELL_OPEN_EXTERNAL]: true,
      [IPC_CHANNELS.CLI_COMMAND_GET_STATUS]: true,
      [IPC_CHANNELS.CLI_COMMAND_INSTALL]: true,
      [IPC_CHANNELS.CLI_COMMAND_REMOVE]: true,
      [IPC_CHANNELS.SETTINGS_OPEN]: true,
      [IPC_CHANNELS.SETTINGS_GET]: true,
      [IPC_CHANNELS.SETTINGS_SET]: true,
      [IPC_CHANNELS.ACTIVITY_LIST]: true,
      [IPC_CHANNELS.FOLDER_REVEAL_IN_FINDER]: true,
      [IPC_CHANNELS.FOLDER_OPEN_IN_TERMINAL]: true,
      [IPC_CHANNELS.WINDOW_GET_MAIN_BOUNDS]: true,
    } as const satisfies Record<keyof IpcInvokeContract, true>

    // Act
    const invokeChannelKeys = Object.keys(invokeMapping)

    // Runtime assertion: mapping covers exactly the contract keys.
    // SECURITY: increment this number only after a security review of the new
    // IPC channel (input validation, authz scope, side-effect blast radius).
    // The `satisfies` clause above is a structural guard; this length check is
    // the trip-wire that forces a human PR diff when a channel is added.
    // Assert
    expect(invokeChannelKeys).toHaveLength(36)
  })

  it('forces a review by tripping when a push-event channel is added or removed', () => {
    // Exhaustive compile-time check: missing or extra keys fail compilation
    // Arrange
    const eventMapping = {
      [IPC_CHANNELS.SKILLS_CLI_PROGRESS]: true,
      [IPC_CHANNELS.SKILLS_DELETE_PROGRESS]: true,
      [IPC_CHANNELS.UPDATE_CHECKING]: true,
      [IPC_CHANNELS.UPDATE_AVAILABLE]: true,
      [IPC_CHANNELS.UPDATE_NOT_AVAILABLE]: true,
      [IPC_CHANNELS.UPDATE_PROGRESS]: true,
      [IPC_CHANNELS.UPDATE_DOWNLOADED]: true,
      [IPC_CHANNELS.UPDATE_ERROR]: true,
      [IPC_CHANNELS.SETTINGS_CHANGED]: true,
      [IPC_CHANNELS.ACTIVITY_CHANGED]: true,
    } as const satisfies Record<keyof IpcEventContract, true>

    // Act
    const eventChannelKeys = Object.keys(eventMapping)

    // Runtime assertion: mapping covers exactly the contract keys
    // Assert
    expect(eventChannelKeys).toHaveLength(10)
  })
})
