import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AbsolutePath,
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  ClearBrokenSymlinkSlotsResult,
  ClearOrphanSymlinksResult,
  FilesystemEntryIdentity,
  RestoreDeletedSkillResult,
  Skill,
  SkillName,
  SymlinkInfo,
  TombstoneId,
} from '@/shared/types'
import { tombstoneId } from '@/shared/types'

const mockGetAll = vi.fn()
const mockUnlinkFromAgent = vi.fn()
const mockCreateSymlinks = vi.fn()
const mockCopyToAgents = vi.fn()
const mockDeleteSkills = vi.fn()
const mockClearOrphanSymlinks = vi.fn()
const mockClearBrokenSymlinkSlots = vi.fn()
const mockUnlinkManyFromAgent = vi.fn()
const mockRestoreDeletedSkill = vi.fn()
const mockOnDeleteProgress = vi.fn()

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

vi.stubGlobal('window', {
  electron: {
    skills: {
      getAll: mockGetAll,
      unlinkFromAgent: mockUnlinkFromAgent,
      createSymlinks: mockCreateSymlinks,
      copyToAgents: mockCopyToAgents,
      deleteSkills: mockDeleteSkills,
      clearOrphanSymlinks: mockClearOrphanSymlinks,
      clearBrokenSymlinkSlots: mockClearBrokenSymlinkSlots,
      unlinkManyFromAgent: mockUnlinkManyFromAgent,
      restoreDeletedSkill: mockRestoreDeletedSkill,
      onDeleteProgress: mockOnDeleteProgress,
    },
  },
})

/**
 * Build a minimal test store with just the skills reducer.
 * Avoids storage middleware + listener middleware used in production.
 */
async function createTestStore() {
  const { default: skillsReducer } = await import('./skillsSlice')
  return configureStore({ reducer: { skills: skillsReducer } })
}

/** Sample skill for testing */
const sampleSkill: Skill = {
  name: 'task',
  description: 'Task management skill',
  path: '/home/user/.agents/skills/task',
  filesystemIdentity: directoryIdentity,
  symlinkCount: 1,
  symlinks: [
    {
      agentId: 'claude-code' as SymlinkInfo['agentId'],
      agentName: 'Claude Code' as SymlinkInfo['agentName'],
      linkPath: '/home/user/.claude/skills/task',
      targetPath: '/home/user/.agents/skills/task',
      status: 'valid',
      isLocal: false,
    },
  ],
  isSource: true,
  isOrphan: false,
}

const secondSkill: Skill = {
  ...sampleSkill,
  name: 'theme-generator',
  path: '/home/user/.agents/skills/theme-generator',
}

const thirdSkill: Skill = {
  ...sampleSkill,
  name: 'browser',
  path: '/home/user/.agents/skills/browser',
}

/** Sample symlink info */
const sampleSymlink: SymlinkInfo = sampleSkill.symlinks[0]

/**
 * Build a reviewed delete target so tests exercise the mandatory path IPC contract.
 * @param skillName - Display name selected by the user.
 * @param skillPath - Reviewed source/local folder path.
 * @returns Delete thunk target with exact filesystem identity.
 * @example deleteTarget('task')
 */
function deleteTarget(
  skillName: Skill['name'],
  skillPath = `/home/user/.agents/skills/${skillName}`,
) {
  return {
    skillName,
    skillPath: skillPath as AbsolutePath,
    filesystemIdentity: directoryIdentity,
  }
}

/**
 * Build a reviewed unlink target so tests exercise the mandatory slot IPC contract.
 * @param skillName - Display name selected by the user.
 * @param linkPath - Reviewed agent slot path.
 * @returns Unlink thunk target with exact agent-slot identity.
 * @example unlinkTarget('task')
 */
function unlinkTarget(
  skillName: Skill['name'],
  linkPath = `/home/user/.cursor/skills/${skillName}`,
) {
  return {
    skillName,
    linkPath: linkPath as AbsolutePath,
    targetPath: `/home/user/.agents/skills/${skillName}` as AbsolutePath,
  }
}

/** Seed items into the store so mid-op reconciliation has something to intersect. */
async function seedItems(
  store: Awaited<ReturnType<typeof createTestStore>>,
  items: Skill[],
): Promise<void> {
  mockGetAll.mockResolvedValueOnce(items)
  const { fetchSkills } = await import('./skillsSlice')
  await store.dispatch(fetchSkills())
}

describe('skillsSlice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('opens with an empty, idle skills list and no pending bulk operations', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const state = store.getState().skills

    // Assert
    expect(state.items).toEqual([])
    expect(state.selectedSkill).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.selectedAddAgentIds).toEqual([])
    expect(state.selectedCopyAgentIds).toEqual([])
    // v2.4 bulk-select state
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.inFlightUnlinkNames).toEqual([])
    expect(state.bulkDeleting).toBe(false)
    expect(state.bulkUnlinking).toBe(false)
    expect(state.bulkProgress).toBeNull()
  })

  // --- Sync reducers (kept from pre-v2.4) ---
  it('opens the detail pane for the clicked skill, then closes it when deselected', async () => {
    // Arrange
    const { selectSkill } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act + Assert — clicking a skill opens its detail
    store.dispatch(selectSkill(sampleSkill))
    expect(store.getState().skills.selectedSkill).toEqual(sampleSkill)

    // Act + Assert — deselecting closes it
    store.dispatch(selectSkill(null))
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  it('opens the unlink confirm for the chosen skill, then closes it when dismissed', async () => {
    // Arrange
    const { setSkillToUnlink } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act + Assert — selecting a skill/symlink arms the unlink confirm
    store.dispatch(
      setSkillToUnlink({ skill: sampleSkill, symlink: sampleSymlink }),
    )
    expect(store.getState().skills.skillToUnlink).not.toBeNull()

    // Act + Assert — passing null dismisses it
    store.dispatch(setSkillToUnlink(null))
    expect(store.getState().skills.skillToUnlink).toBeNull()
  })

  it('opens the Add modal on a clean agent checklist and clears it again on close', async () => {
    // Arrange — a stale agent tick exists before the modal opens
    const { setSkillToAddSymlinks, toggleAddAgentSelection } =
      await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(toggleAddAgentSelection('codex' as AgentId))

    // Act + Assert — opening the Add modal resets the checklist to empty
    store.dispatch(setSkillToAddSymlinks(sampleSkill))
    expect(store.getState().skills.skillToAddSymlinks).toEqual(sampleSkill)
    expect(store.getState().skills.selectedAddAgentIds).toEqual([])

    // Act + Assert — closing the modal clears the checklist again
    store.dispatch(toggleAddAgentSelection('cursor' as AgentId))
    store.dispatch(setSkillToAddSymlinks(null))
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
    expect(store.getState().skills.selectedAddAgentIds).toEqual([])
  })

  it('ticks and un-ticks an agent in the Add modal checklist', async () => {
    // Arrange
    const { toggleAddAgentSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act + Assert — first toggle ticks the agent
    store.dispatch(toggleAddAgentSelection('codex' as AgentId))
    expect(store.getState().skills.selectedAddAgentIds).toEqual(['codex'])

    // Act + Assert — second toggle un-ticks it
    store.dispatch(toggleAddAgentSelection('codex' as AgentId))
    expect(store.getState().skills.selectedAddAgentIds).toEqual([])
  })

  it('opens the Copy modal for a skill, then clears the copy checklist on close', async () => {
    // Arrange
    const { setSkillToCopy, toggleCopyAgentSelection } =
      await import('./skillsSlice')
    const store = await createTestStore()

    // Act + Assert — opening arms the Copy modal
    store.dispatch(setSkillToCopy(sampleSkill))
    expect(store.getState().skills.skillToCopy).toEqual(sampleSkill)

    // Act + Assert — closing clears both the target and the checklist
    store.dispatch(toggleCopyAgentSelection('cursor' as AgentId))
    store.dispatch(setSkillToCopy(null))
    expect(store.getState().skills.skillToCopy).toBeNull()
    expect(store.getState().skills.selectedCopyAgentIds).toEqual([])
  })

  it('ticks, un-ticks, and bulk-clears agents in the Copy modal checklist', async () => {
    // Arrange
    const { toggleCopyAgentSelection, clearCopyAgentSelection } =
      await import('./skillsSlice')
    const store = await createTestStore()

    // Act + Assert — first toggle ticks the agent
    store.dispatch(toggleCopyAgentSelection('codex' as AgentId))
    expect(store.getState().skills.selectedCopyAgentIds).toEqual(['codex'])

    // Act + Assert — second toggle un-ticks it
    store.dispatch(toggleCopyAgentSelection('codex' as AgentId))
    expect(store.getState().skills.selectedCopyAgentIds).toEqual([])

    // Act + Assert — clearing wipes the whole checklist at once
    store.dispatch(toggleCopyAgentSelection('cursor' as AgentId))
    store.dispatch(clearCopyAgentSelection())
    expect(store.getState().skills.selectedCopyAgentIds).toEqual([])
  })

  // --- fetchSkills thunk ---
  it('shows a loading state while the skills inventory is being fetched', async () => {
    // Arrange — keep the fetch pending so the loading state is observable
    let resolve!: (value: Skill[]) => void
    mockGetAll.mockReturnValue(
      new Promise<Skill[]>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { fetchSkills } = await import('./skillsSlice')

    // Act
    const promise = store.dispatch(fetchSkills())

    // Assert
    expect(store.getState().skills.loading).toBe(true)
    expect(store.getState().skills.error).toBeNull()

    resolve([sampleSkill])
    await promise
  })

  it('lists the fetched skills once the inventory load resolves', async () => {
    // Arrange
    mockGetAll.mockResolvedValue([sampleSkill])
    const store = await createTestStore()
    const { fetchSkills } = await import('./skillsSlice')

    // Act
    await store.dispatch(fetchSkills())

    // Assert
    const state = store.getState().skills
    expect(state.items).toHaveLength(1)
    expect(state.items[0].name).toBe('task')
    expect(state.loading).toBe(false)
  })

  it('surfaces the failure message when the skills inventory load fails', async () => {
    // Arrange
    mockGetAll.mockRejectedValue(new Error('Network error'))
    const store = await createTestStore()
    const { fetchSkills } = await import('./skillsSlice')

    // Act
    await store.dispatch(fetchSkills())

    // Assert
    const state = store.getState().skills
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Network error')
  })

  // --- unlinkSkillFromAgent thunk ---
  it('closes the detail pane and unlink confirm once a single unlink succeeds', async () => {
    // Arrange
    mockUnlinkFromAgent.mockResolvedValue({ success: true })
    const store = await createTestStore()
    const { selectSkill, unlinkSkillFromAgent } = await import('./skillsSlice')
    store.dispatch(selectSkill(sampleSkill))

    // Act
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: sampleSymlink }),
    )

    // Assert
    expect(store.getState().skills.selectedSkill).toBeNull()
    expect(store.getState().skills.skillToUnlink).toBeNull()
    expect(store.getState().skills.unlinking).toBe(false)
  })

  it('surfaces the failure message when a single unlink is rejected by the OS', async () => {
    // Arrange
    mockUnlinkFromAgent.mockResolvedValue({
      success: false,
      error: 'Permission denied',
    })
    const store = await createTestStore()
    const { unlinkSkillFromAgent } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: sampleSymlink }),
    )

    // Assert
    expect(store.getState().skills.unlinking).toBe(false)
    expect(store.getState().skills.error).toBe('Permission denied')
  })

  it('sends the reviewed local directory identity to IPC when unlinking a local slot', async () => {
    // Arrange
    mockUnlinkFromAgent.mockResolvedValue({ success: true })
    const localSymlink: SymlinkInfo = {
      ...sampleSymlink,
      isLocal: true,
      targetPath: undefined,
      filesystemIdentity: directoryIdentity,
    }
    const store = await createTestStore()
    const { unlinkSkillFromAgent } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: localSymlink }),
    )

    // Assert
    expect(mockUnlinkFromAgent).toHaveBeenCalledWith({
      skillName: 'task',
      agentId: 'claude-code',
      linkPath: '/home/user/.claude/skills/task',
      confirmedLocalDirectoryDelete: true,
      reviewedDirectoryIdentity: directoryIdentity,
    })
  })

  it('unlinkSkillFromAgent asks for rescan when local directory identity is missing', async () => {
    // Arrange
    const localSymlink: SymlinkInfo = {
      ...sampleSymlink,
      isLocal: true,
      targetPath: undefined,
      filesystemIdentity: undefined,
    }

    const store = await createTestStore()
    const { unlinkSkillFromAgent } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: localSymlink }),
    )

    // Assert
    expect(mockUnlinkFromAgent).not.toHaveBeenCalled()
    expect(store.getState().skills.error).toBe(
      'Rescan before delete. The reviewed local folder identity is missing.',
    )
  })

  it('unlinkSkillFromAgent asks for rescan when symlink target identity is missing', async () => {
    // Arrange
    const staleSymlink: SymlinkInfo = {
      ...sampleSymlink,
      isLocal: false,
      targetPath: undefined,
    }

    const store = await createTestStore()
    const { unlinkSkillFromAgent } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: staleSymlink }),
    )

    // Assert
    expect(mockUnlinkFromAgent).not.toHaveBeenCalled()
    expect(store.getState().skills.error).toBe(
      'Rescan before unlink. The reviewed symlink target is missing.',
    )
  })

  // --- createSymlinks thunk ---
  it('closes the Add modal and clears its checklist once symlinks are created', async () => {
    // Arrange
    mockCreateSymlinks.mockResolvedValue({
      success: true,
      created: 2,
      failures: [],
    })
    const store = await createTestStore()
    const { setSkillToAddSymlinks, toggleAddAgentSelection, createSymlinks } =
      await import('./skillsSlice')
    store.dispatch(setSkillToAddSymlinks(sampleSkill))
    store.dispatch(toggleAddAgentSelection('cursor' as AgentId))

    // Act
    await store.dispatch(
      createSymlinks({
        skill: sampleSkill,
        agentIds: ['cursor' as AgentId, 'codex' as AgentId],
      }),
    )

    // Assert
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
    expect(store.getState().skills.selectedAddAgentIds).toEqual([])
    expect(store.getState().skills.addingSymlinks).toBe(false)
  })

  it('surfaces an error when every requested symlink fails to create', async () => {
    // Arrange
    mockCreateSymlinks.mockResolvedValue({
      success: false,
      created: 0,
      failures: ['cursor'],
    })
    const store = await createTestStore()
    const { createSymlinks } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      createSymlinks({ skill: sampleSkill, agentIds: ['cursor' as AgentId] }),
    )

    // Assert
    expect(store.getState().skills.error).toBe('Failed to create any symlinks')
  })

  // --- copyToAgents thunk ---
  it('closes both the Copy and Add modals and clears their checklists once the copy succeeds', async () => {
    // Arrange
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 1,
      failures: [],
    })
    const store = await createTestStore()
    const {
      setSkillToAddSymlinks,
      setSkillToCopy,
      toggleAddAgentSelection,
      toggleCopyAgentSelection,
      copyToAgents,
    } = await import('./skillsSlice')
    store.dispatch(setSkillToCopy(sampleSkill))
    store.dispatch(setSkillToAddSymlinks(sampleSkill))
    store.dispatch(toggleAddAgentSelection('cursor' as AgentId))
    store.dispatch(toggleCopyAgentSelection('codex' as AgentId))

    // Act
    await store.dispatch(
      copyToAgents({
        skill: sampleSkill,
        sourcePath: sampleSymlink.linkPath,
        agentIds: ['codex' as AgentId],
      }),
    )

    // Assert
    expect(store.getState().skills.skillToCopy).toBeNull()
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
    expect(store.getState().skills.selectedAddAgentIds).toEqual([])
    expect(store.getState().skills.selectedCopyAgentIds).toEqual([])
    expect(store.getState().skills.copying).toBe(false)
  })

  it('surfaces an error when the copy fails for every target agent', async () => {
    // Arrange
    mockCopyToAgents.mockResolvedValue({
      success: false,
      copied: 0,
      failures: ['codex'],
    })
    const store = await createTestStore()
    const { copyToAgents } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      copyToAgents({
        skill: sampleSkill,
        sourcePath: sampleSymlink.linkPath,
        agentIds: ['codex' as AgentId],
      }),
    )

    // Assert
    expect(store.getState().skills.error).toBe('Failed to copy to any agent')
  })
})

describe('skillsSlice bulkCopyToAgents thunk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const item = (
    name: string,
  ): { skillName: SkillName; sourcePath: AbsolutePath } => ({
    skillName: name as SkillName,
    sourcePath: `/Users/me/.agents/skills/${name}` as AbsolutePath,
  })

  it('copies every selected skill to the chosen agents and returns one outcome per skill', async () => {
    // Arrange
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 2,
      failures: [],
    })
    const store = await createTestStore()
    const { bulkCopyToAgents } = await import('./skillsSlice')

    // Act
    const result = await store.dispatch(
      bulkCopyToAgents({
        items: [item('alpha'), item('beta')],
        agentIds: ['codex' as AgentId, 'cursor' as AgentId],
      }),
    )

    // Assert
    expect(mockCopyToAgents).toHaveBeenCalledTimes(2)
    expect(bulkCopyToAgents.fulfilled.match(result)).toBe(true)
    if (bulkCopyToAgents.fulfilled.match(result)) {
      expect(result.payload.perSkill).toEqual([
        { skillName: 'alpha', copied: 2, failures: [] },
        { skillName: 'beta', copied: 2, failures: [] },
      ])
    }
    expect(store.getState().skills.bulkCopying).toBe(false)
  })

  it('keeps copying the rest of the batch when one skill fails on an occupied target', async () => {
    // Arrange — alpha is clean; beta already exists on codex
    mockCopyToAgents
      .mockResolvedValueOnce({ success: true, copied: 1, failures: [] })
      .mockResolvedValueOnce({
        success: false,
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      })
    const store = await createTestStore()
    const { bulkCopyToAgents } = await import('./skillsSlice')

    // Act
    const result = await store.dispatch(
      bulkCopyToAgents({
        items: [item('alpha'), item('beta')],
        agentIds: ['codex' as AgentId],
      }),
    )

    // Assert — both attempted (no abort), beta's per-target failure recorded
    expect(mockCopyToAgents).toHaveBeenCalledTimes(2)
    if (bulkCopyToAgents.fulfilled.match(result)) {
      expect(result.payload.perSkill[0]).toEqual({
        skillName: 'alpha',
        copied: 1,
        failures: [],
      })
      expect(result.payload.perSkill[1]).toEqual({
        skillName: 'beta',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      })
    }
  })

  it('records a per-target failure when the copy IPC rejects, without aborting the batch', async () => {
    // Arrange — alpha's IPC throws (e.g. source path validation), beta succeeds
    mockCopyToAgents
      .mockRejectedValueOnce(new Error('Invalid source path'))
      .mockResolvedValueOnce({ success: true, copied: 1, failures: [] })
    const store = await createTestStore()
    const { bulkCopyToAgents } = await import('./skillsSlice')

    // Act
    const result = await store.dispatch(
      bulkCopyToAgents({
        items: [item('alpha'), item('beta')],
        agentIds: ['codex' as AgentId],
      }),
    )

    // Assert — alpha rejected → recorded as a failure; beta still copied
    expect(mockCopyToAgents).toHaveBeenCalledTimes(2)
    if (bulkCopyToAgents.fulfilled.match(result)) {
      expect(result.payload.perSkill[0]).toEqual({
        skillName: 'alpha',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Invalid source path' }],
      })
      expect(result.payload.perSkill[1]).toEqual({
        skillName: 'beta',
        copied: 1,
        failures: [],
      })
    }
  })

  it('sets bulkCopying true while in flight and false once settled', async () => {
    // Arrange
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 1,
      failures: [],
    })
    const store = await createTestStore()
    const { bulkCopyToAgents } = await import('./skillsSlice')

    // Act — read the flag before awaiting the dispatch
    const pending = store.dispatch(
      bulkCopyToAgents({
        items: [item('alpha')],
        agentIds: ['codex' as AgentId],
      }),
    )
    const inFlight = store.getState().skills.bulkCopying
    await pending

    // Assert
    expect(inFlight).toBe(true)
    expect(store.getState().skills.bulkCopying).toBe(false)
  })

  it('leaves the list selection intact after copying so the same rows can be copied elsewhere', async () => {
    // Arrange — two skills ticked; copy is non-destructive
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 1,
      failures: [],
    })
    const store = await createTestStore()
    const { bulkCopyToAgents, selectAll } = await import('./skillsSlice')
    store.dispatch(selectAll(['alpha' as SkillName, 'beta' as SkillName]))

    // Act
    await store.dispatch(
      bulkCopyToAgents({
        items: [item('alpha'), item('beta')],
        agentIds: ['codex' as AgentId],
      }),
    )

    // Assert — selection survives (unlike deleteSelectedSkills, which clears it)
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('cancels a dispatch while another bulk copy is already in flight (single-flight guard)', async () => {
    // Arrange — simulate an in-flight batch by putting the slice in its pending
    // state, exactly as a real first dispatch would (bulkCopying = true).
    const store = await createTestStore()
    const { bulkCopyToAgents } = await import('./skillsSlice')
    store.dispatch(
      bulkCopyToAgents.pending('inflight-request-id', {
        items: [item('alpha')],
        agentIds: ['codex' as AgentId],
      }),
    )
    expect(store.getState().skills.bulkCopying).toBe(true)

    // Act — a second concurrent dispatch must be cancelled by the thunk's
    // `condition` before its payload creator (the IPC fan-out) ever runs.
    const result = await store.dispatch(
      bulkCopyToAgents({
        items: [item('beta')],
        agentIds: ['codex' as AgentId],
      }),
    )

    // Assert — rejected via `condition`, and the copy IPC was never invoked
    expect(bulkCopyToAgents.rejected.match(result)).toBe(true)
    if (bulkCopyToAgents.rejected.match(result)) {
      expect(result.meta.condition).toBe(true)
    }
    expect(mockCopyToAgents).not.toHaveBeenCalled()
  })
})

describe('skillsSlice bulk selection reducers (v2.4)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('selects a clicked row and pins it as the range anchor', async () => {
    // Arrange
    const { toggleSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('task'))

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().skills.selectionAnchor).toBe('task')
  })

  it('deselects a row on a second click but keeps it as the anchor', async () => {
    // Arrange
    const { toggleSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('task'))
    store.dispatch(toggleSelection('task'))

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    // Anchor remains — matches macOS Finder "last clicked row" semantics
    expect(store.getState().skills.selectionAnchor).toBe('task')
  })

  it('shift-clicking a range adds the spanned rows in order and moves the anchor to the end', async () => {
    // Arrange
    const { toggleSelection, selectRange } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('task'))
    store.dispatch(selectRange(['task', 'theme', 'browser']))

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task',
      'theme',
      'browser',
    ])
    // Anchor advances to the last target of the range
    expect(store.getState().skills.selectionAnchor).toBe('browser')
  })

  it('keeps each row once when a shift-click range overlaps the existing selection', async () => {
    // Arrange
    const { toggleSelection, selectRange } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('task'))
    store.dispatch(toggleSelection('browser'))
    store.dispatch(selectRange(['task', 'theme', 'browser']))

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task',
      'browser',
      'theme',
    ])
  })

  it('replaces the whole selection and moves the anchor to the last row when select-all runs', async () => {
    // Arrange
    const { toggleSelection, selectAll } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('zebra'))
    store.dispatch(selectAll(['task', 'theme', 'browser']))

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task',
      'theme',
      'browser',
    ])
    expect(store.getState().skills.selectionAnchor).toBe('browser')
  })

  it('clears the selection and anchor when select-all is given an empty list', async () => {
    // Arrange
    const { toggleSelection, selectAll } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('task'))
    store.dispatch(selectAll([]))

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectionAnchor).toBeNull()
  })

  it('clears the selection and anchor when the user clears the selection', async () => {
    // Arrange
    const { toggleSelection, clearSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(toggleSelection('task'))
    store.dispatch(toggleSelection('theme'))
    store.dispatch(clearSelection())

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectionAnchor).toBeNull()
  })

  it('shows the bulk progress counter during an operation and hides it when cleared', async () => {
    // Arrange
    const { setBulkProgress } = await import('./skillsSlice')
    const store = await createTestStore()

    // Act + Assert — setting a counter shows progress
    store.dispatch(setBulkProgress({ current: 3, total: 10 }))
    expect(store.getState().skills.bulkProgress).toEqual({
      current: 3,
      total: 10,
    })

    // Act + Assert — clearing hides it
    store.dispatch(setBulkProgress(null))
    expect(store.getState().skills.bulkProgress).toBeNull()
  })
})

describe('skillsSlice deleteSelectedSkills thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('marks only the still-present skills as deleting and drops a ghost name while a bulk delete is in flight', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill, secondSkill])
    // Hold the thunk pending indefinitely
    let resolve!: (value: BulkDeleteResult) => void
    mockDeleteSkills.mockReturnValue(
      new Promise<BulkDeleteResult>((r) => {
        resolve = r
      }),
    )
    const { deleteSelectedSkills } = await import('./skillsSlice')

    // Act — include a ghost name that is NOT in state.items; reconciliation should drop it
    const promise = store.dispatch(
      deleteSelectedSkills([
        deleteTarget('task'),
        deleteTarget('theme-generator'),
        deleteTarget('already-gone'),
      ]),
    )

    // Assert
    expect(store.getState().skills.bulkDeleting).toBe(true)
    expect(store.getState().skills.inFlightDeleteNames).toEqual([
      'task',
      'theme-generator',
    ])
    expect(store.getState().skills.error).toBeNull()

    resolve({
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaaaaaa'),
          symlinksRemoved: 2,
          cascadeAgents: [],
        },
        {
          skillName: 'theme-generator',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-theme-generator-bbbbbbbb'),
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
        {
          skillName: 'already-gone',
          outcome: 'error',
          error: { message: 'Not present' },
        },
      ],
    })
    await promise
  })

  it('sends the reviewed source path through the deleteSkills IPC call', async () => {
    // Arrange
    const store = await createTestStore()
    mockDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: 'metadata-title',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-metadata-title-aaaaaaaa'),
          symlinksRemoved: 1,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    const { deleteSelectedSkills } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      deleteSelectedSkills([
        {
          skillName: 'metadata-title',
          skillPath:
            '/home/user/.agents/skills/folder-basename' as AbsolutePath,
          filesystemIdentity: directoryIdentity,
        },
      ]),
    )

    // Assert
    expect(mockDeleteSkills).toHaveBeenCalledWith({
      items: [
        {
          skillName: 'metadata-title',
          skillPath: '/home/user/.agents/skills/folder-basename',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
  })

  it('resets the selection, anchor, busy flag, and progress counter once a bulk delete completes', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaaaaaa'),
          symlinksRemoved: 1,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    const { deleteSelectedSkills, toggleSelection, setBulkProgress } =
      await import('./skillsSlice')
    store.dispatch(toggleSelection('task'))
    store.dispatch(setBulkProgress({ current: 1, total: 1 }))

    // Act
    await store.dispatch(deleteSelectedSkills([deleteTarget('task')]))

    // Assert
    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
    expect(state.bulkProgress).toBeNull()
  })

  it('resets the selection and anchor when a delete instead clears an orphan symlink', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: 'task',
          outcome: 'orphan-cleared',
          symlinksRemoved: 1,
          cascadeAgents: ['claude-code' as AgentId],
        },
      ],
    } satisfies BulkDeleteResult)
    const { deleteSelectedSkills, toggleSelection, setBulkProgress } =
      await import('./skillsSlice')
    store.dispatch(toggleSelection('task'))
    store.dispatch(setBulkProgress({ current: 1, total: 1 }))

    // Act
    await store.dispatch(deleteSelectedSkills([deleteTarget('task')]))

    // Assert
    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
    expect(state.bulkProgress).toBeNull()
  })

  it('clears the in-flight delete state and surfaces the error when a bulk delete is rejected', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockDeleteSkills.mockRejectedValue(new Error('EACCES'))
    const { deleteSelectedSkills } = await import('./skillsSlice')

    // Act
    await store.dispatch(deleteSelectedSkills([deleteTarget('task')]))

    // Assert
    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.error).toBe('EACCES')
  })
})

describe('skillsSlice clearSelectedOrphanSymlinks thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('marks only the still-present orphan as clearing and drops a ghost name while cleanup is in flight', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill, secondSkill])
    let resolve!: (value: ClearOrphanSymlinksResult) => void
    mockClearOrphanSymlinks.mockReturnValue(
      new Promise<ClearOrphanSymlinksResult>((r) => {
        resolve = r
      }),
    )
    const { clearSelectedOrphanSymlinks } = await import('./skillsSlice')

    // Act — 'ghost' is not in state.items so reconciliation should drop it
    const promise = store.dispatch(
      clearSelectedOrphanSymlinks([
        {
          skillName: 'task',
          agents: [
            {
              agentId: 'codex' as AgentId,
              linkPath: '/home/user/.codex/skills/task',
              targetPath: '/home/user/.agents/skills/task',
            },
          ],
        },
        {
          skillName: 'ghost',
          agents: [
            {
              agentId: 'cursor' as AgentId,
              linkPath: '/home/user/.cursor/skills/ghost',
              targetPath: '/home/user/.agents/skills/ghost',
            },
          ],
        },
      ]),
    )

    // Assert
    expect(store.getState().skills.bulkDeleting).toBe(true)
    expect(store.getState().skills.inFlightDeleteNames).toEqual(['task'])

    resolve({
      items: [
        {
          skillName: 'task',
          outcome: 'orphan-cleared',
          symlinksRemoved: 1,
          cascadeAgents: ['codex' as AgentId],
        },
      ],
    })
    await promise
  })

  it('resets the orphan selection, anchor, busy flag, and progress counter once cleanup completes', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: 'task',
          outcome: 'orphan-cleared',
          symlinksRemoved: 1,
          cascadeAgents: ['codex' as AgentId],
        },
      ],
    } satisfies ClearOrphanSymlinksResult)
    const { clearSelectedOrphanSymlinks, setBulkProgress, toggleSelection } =
      await import('./skillsSlice')
    store.dispatch(toggleSelection('task'))
    store.dispatch(setBulkProgress({ current: 1, total: 1 }))

    // Act
    await store.dispatch(
      clearSelectedOrphanSymlinks([
        {
          skillName: 'task',
          agents: [
            {
              agentId: 'codex' as AgentId,
              linkPath: '/home/user/.codex/skills/task',
              targetPath: '/home/user/.agents/skills/task',
            },
          ],
        },
      ]),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
    expect(state.bulkProgress).toBeNull()
  })

  it('keeps a failed orphan row selected for retry while ending the busy state', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: 'task',
          outcome: 'error',
          error: { message: 'Rescan before cleanup.' },
        },
      ],
    } satisfies ClearOrphanSymlinksResult)
    const { clearSelectedOrphanSymlinks, toggleSelection } =
      await import('./skillsSlice')
    store.dispatch(toggleSelection('task'))

    // Act
    await store.dispatch(
      clearSelectedOrphanSymlinks([
        {
          skillName: 'task',
          agents: [
            {
              agentId: 'codex' as AgentId,
              linkPath: '/home/user/.codex/skills/task',
              targetPath: '/home/user/.agents/skills/task',
            },
          ],
        },
      ]),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.selectedSkillNames).toEqual(['task'])
    expect(state.selectionAnchor).toBe('task')
  })

  it('clears the in-flight orphan state and surfaces the error when cleanup is rejected', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockClearOrphanSymlinks.mockRejectedValue(new Error('Permission denied'))
    const { clearSelectedOrphanSymlinks } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      clearSelectedOrphanSymlinks([
        {
          skillName: 'task',
          agents: [
            {
              agentId: 'codex' as AgentId,
              linkPath: '/home/user/.codex/skills/task',
              targetPath: '/home/user/.agents/skills/task',
            },
          ],
        },
      ]),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.error).toBe('Permission denied')
  })
})

describe('skillsSlice clearSelectedBrokenSymlinkSlots thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('matches a broken slot to its live skill by display name, not on-disk basename, while cleanup is in flight', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    let resolve!: (value: ClearBrokenSymlinkSlotsResult) => void
    mockClearBrokenSymlinkSlots.mockReturnValue(
      new Promise<ClearBrokenSymlinkSlotsResult>((r) => {
        resolve = r
      }),
    )
    const { clearSelectedBrokenSymlinkSlots } = await import('./skillsSlice')

    // Act
    const promise = store.dispatch(
      clearSelectedBrokenSymlinkSlots({
        items: [
          {
            agentId: 'codex' as AgentId,
            // linkName (on-disk basename) intentionally differs from
            // displaySkillName to prove reconciliation matches the live
            // skill.name ('task'), not the symlink basename.
            linkName: 'task-symlink',
            displaySkillName: 'task',
            linkPath: '/home/user/.codex/skills/task-symlink',
            targetPath: '/home/user/.agents/skills/task',
          },
          {
            agentId: 'cursor' as AgentId,
            linkName: 'ghost',
            displaySkillName: 'ghost',
            linkPath: '/home/user/.cursor/skills/ghost',
            targetPath: '/home/user/.agents/skills/ghost',
          },
        ],
      }),
    )

    // Assert
    expect(store.getState().skills.bulkUnlinking).toBe(true)
    expect(store.getState().skills.inFlightUnlinkNames).toEqual(['task'])

    resolve({
      items: [
        {
          agentId: 'codex' as AgentId,
          skillName: 'task',
          linkPath: '/home/user/.codex/skills/task',
          outcome: 'unlinked',
        },
      ],
    })
    await promise
  })

  it('ends the broken-slot busy state once the cleanup completes', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'codex' as AgentId,
          skillName: 'task',
          linkPath: '/home/user/.codex/skills/task',
          outcome: 'unlinked',
        },
      ],
    } satisfies ClearBrokenSymlinkSlotsResult)
    const { clearSelectedBrokenSymlinkSlots } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      clearSelectedBrokenSymlinkSlots({
        items: [
          {
            agentId: 'codex' as AgentId,
            linkName: 'task',
            displaySkillName: 'task',
            linkPath: '/home/user/.codex/skills/task',
            targetPath: '/home/user/.agents/skills/task',
          },
        ],
      }),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkUnlinking).toBe(false)
    expect(state.inFlightUnlinkNames).toEqual([])
  })

  it('ends the broken-slot busy state and surfaces the error when cleanup is rejected', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockClearBrokenSymlinkSlots.mockRejectedValue(
      new Error('Permission denied'),
    )
    const { clearSelectedBrokenSymlinkSlots } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      clearSelectedBrokenSymlinkSlots({
        items: [
          {
            agentId: 'codex' as AgentId,
            linkName: 'task',
            displaySkillName: 'task',
            linkPath: '/home/user/.codex/skills/task',
            targetPath: '/home/user/.agents/skills/task',
          },
        ],
      }),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkUnlinking).toBe(false)
    expect(state.inFlightUnlinkNames).toEqual([])
    expect(state.error).toBe('Permission denied')
  })
})

describe('skillsSlice unlinkSelectedFromAgent thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('marks only the still-present skills as unlinking and drops a ghost name while a bulk unlink is in flight', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill, secondSkill, thirdSkill])
    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    // Act — 'ghost' is not in state.items so reconciliation should drop it
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [
          unlinkTarget('task'),
          unlinkTarget('browser'),
          unlinkTarget('ghost'),
        ],
      }),
    )

    // Assert
    expect(store.getState().skills.bulkUnlinking).toBe(true)
    expect(store.getState().skills.inFlightUnlinkNames).toEqual([
      'task',
      'browser',
    ])

    resolve({
      items: [
        { skillName: 'task', outcome: 'unlinked' },
        { skillName: 'browser', outcome: 'unlinked' },
      ],
    })
    await promise
  })

  it('sends the reviewed agent slot path through the unlinkManyFromAgent IPC call', async () => {
    // Arrange
    const store = await createTestStore()
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [{ skillName: 'metadata-title', outcome: 'unlinked' }],
    } satisfies BulkUnlinkResult)
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [
          {
            skillName: 'metadata-title',
            linkPath:
              '/home/user/.cursor/skills/folder-basename' as AbsolutePath,
            targetPath:
              '/home/user/.agents/skills/folder-basename' as AbsolutePath,
          },
        ],
      }),
    )

    // Assert
    expect(mockUnlinkManyFromAgent).toHaveBeenCalledWith({
      agentId: 'cursor',
      items: [
        {
          skillName: 'metadata-title',
          linkPath: '/home/user/.cursor/skills/folder-basename',
          targetPath: '/home/user/.agents/skills/folder-basename',
        },
      ],
    })
  })

  it('resets the selection, anchor, and busy flag once a bulk unlink completes', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [{ skillName: 'task', outcome: 'unlinked' }],
    } satisfies BulkUnlinkResult)
    const { unlinkSelectedFromAgent, toggleSelection } =
      await import('./skillsSlice')
    store.dispatch(toggleSelection('task'))

    // Act
    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('task')],
      }),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkUnlinking).toBe(false)
    expect(state.inFlightUnlinkNames).toEqual([])
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
  })

  it('clears the in-flight unlink state and surfaces the error when a bulk unlink is rejected', async () => {
    // Arrange
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Permission denied'))
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    // Act
    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('task')],
      }),
    )

    // Assert
    const state = store.getState().skills
    expect(state.bulkUnlinking).toBe(false)
    expect(state.inFlightUnlinkNames).toEqual([])
    expect(state.error).toBe('Permission denied')
  })
})

describe('skillsSlice undoLastBulkDelete thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('restores each tombstone one at a time in the order they were deleted', async () => {
    // Arrange
    const calls: TombstoneId[] = []
    mockRestoreDeletedSkill.mockImplementation(
      async ({ tombstoneId: id }: { tombstoneId: TombstoneId }) => {
        calls.push(id)
        return {
          outcome: 'restored',
          symlinksRestored: 1,
          symlinksSkipped: 0,
        } satisfies RestoreDeletedSkillResult
      },
    )
    const store = await createTestStore()
    const { undoLastBulkDelete } = await import('./skillsSlice')
    const ids = [
      tombstoneId('1-task-aaaaaaaa'),
      tombstoneId('1-theme-bbbbbbbb'),
    ]

    // Act
    await store.dispatch(undoLastBulkDelete(ids))

    // Assert
    expect(calls).toEqual(ids)
    expect(mockRestoreDeletedSkill).toHaveBeenCalledTimes(2)
  })

  it('reports each undo result in the same order as the requested tombstones', async () => {
    // Arrange
    mockRestoreDeletedSkill
      .mockResolvedValueOnce({
        outcome: 'restored',
        symlinksRestored: 1,
        symlinksSkipped: 0,
      } satisfies RestoreDeletedSkillResult)
      .mockResolvedValueOnce({
        outcome: 'error',
        error: { message: 'Trash entry missing' },
      } satisfies RestoreDeletedSkillResult)
    const store = await createTestStore()
    const { undoLastBulkDelete } = await import('./skillsSlice')
    const ids = [
      tombstoneId('1-task-aaaaaaaa'),
      tombstoneId('1-theme-bbbbbbbb'),
    ]

    // Act
    const action = await store.dispatch(undoLastBulkDelete(ids))

    // Assert
    if (!undoLastBulkDelete.fulfilled.match(action)) {
      throw new Error('Expected undoLastBulkDelete to fulfill, got rejected')
    }
    expect(action.payload).toHaveLength(2)
    expect(action.payload[0].result.outcome).toBe('restored')
    expect(action.payload[1].result.outcome).toBe('error')
  })

  // The thunk catches IPC rejections per-item and surfaces them as
  // `{ outcome: 'error' }` entries so a single failure does not discard the
  // restored-items in the same batch (see Batch 6 / CodeRabbit thread #18).
  // As a result `state.skills.error` is NOT set on IPC rejection — callers
  // must inspect the per-item payload to build a "N of M restored" toast.
  it('reports a failed restore as a per-item error without tripping the slice-level error banner', async () => {
    // Arrange
    mockRestoreDeletedSkill.mockRejectedValue(new Error('Disk full'))
    const store = await createTestStore()
    const { undoLastBulkDelete } = await import('./skillsSlice')

    // Act
    const action = await store.dispatch(
      undoLastBulkDelete([tombstoneId('1-task-aaaaaaaa')]),
    )

    // Assert
    if (!undoLastBulkDelete.fulfilled.match(action)) {
      throw new Error('Expected undoLastBulkDelete to fulfill, got rejected')
    }
    expect(action.payload).toHaveLength(1)
    expect(action.payload[0].result.outcome).toBe('error')
    if (action.payload[0].result.outcome === 'error') {
      expect(action.payload[0].result.error.message).toBe('Disk full')
    }
    expect(store.getState().skills.error).toBeNull()
  })
})
