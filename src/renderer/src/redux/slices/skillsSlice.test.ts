import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  RestoreDeletedSkillResult,
  Skill,
  SymlinkInfo,
  TombstoneId,
} from '../../../../shared/types'
import { tombstoneId } from '../../../../shared/types'

const mockGetAll = vi.fn()
const mockUnlinkFromAgent = vi.fn()
const mockCreateSymlinks = vi.fn()
const mockCopyToAgents = vi.fn()
const mockDeleteSkills = vi.fn()
const mockUnlinkManyFromAgent = vi.fn()
const mockRestoreDeletedSkill = vi.fn()
const mockOnDeleteProgress = vi.fn()

vi.stubGlobal('window', {
  electron: {
    skills: {
      getAll: mockGetAll,
      unlinkFromAgent: mockUnlinkFromAgent,
      createSymlinks: mockCreateSymlinks,
      copyToAgents: mockCopyToAgents,
      deleteSkills: mockDeleteSkills,
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

  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().skills
    expect(state.items).toEqual([])
    expect(state.selectedSkill).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
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
  it('selectSkill sets selectedSkill', async () => {
    const { selectSkill } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(selectSkill(sampleSkill))
    expect(store.getState().skills.selectedSkill).toEqual(sampleSkill)

    store.dispatch(selectSkill(null))
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  it('setSkillToUnlink sets and clears pending unlink', async () => {
    const { setSkillToUnlink } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      setSkillToUnlink({ skill: sampleSkill, symlink: sampleSymlink }),
    )
    expect(store.getState().skills.skillToUnlink).not.toBeNull()

    store.dispatch(setSkillToUnlink(null))
    expect(store.getState().skills.skillToUnlink).toBeNull()
  })

  it('setSkillToAddSymlinks sets and clears pending add', async () => {
    const { setSkillToAddSymlinks } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(setSkillToAddSymlinks(sampleSkill))
    expect(store.getState().skills.skillToAddSymlinks).toEqual(sampleSkill)

    store.dispatch(setSkillToAddSymlinks(null))
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
  })

  it('setSkillToCopy sets and clears pending copy', async () => {
    const { setSkillToCopy } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(setSkillToCopy(sampleSkill))
    expect(store.getState().skills.skillToCopy).toEqual(sampleSkill)

    store.dispatch(setSkillToCopy(null))
    expect(store.getState().skills.skillToCopy).toBeNull()
  })

  // --- fetchSkills thunk ---
  it('fetchSkills sets loading during pending', async () => {
    let resolve!: (value: Skill[]) => void
    mockGetAll.mockReturnValue(
      new Promise<Skill[]>((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { fetchSkills } = await import('./skillsSlice')
    const promise = store.dispatch(fetchSkills())

    expect(store.getState().skills.loading).toBe(true)
    expect(store.getState().skills.error).toBeNull()

    resolve([sampleSkill])
    await promise
  })

  it('fetchSkills populates items on fulfilled', async () => {
    mockGetAll.mockResolvedValue([sampleSkill])

    const store = await createTestStore()
    const { fetchSkills } = await import('./skillsSlice')
    await store.dispatch(fetchSkills())

    const state = store.getState().skills
    expect(state.items).toHaveLength(1)
    expect(state.items[0].name).toBe('task')
    expect(state.loading).toBe(false)
  })

  it('fetchSkills sets error on rejected', async () => {
    mockGetAll.mockRejectedValue(new Error('Network error'))

    const store = await createTestStore()
    const { fetchSkills } = await import('./skillsSlice')
    await store.dispatch(fetchSkills())

    const state = store.getState().skills
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Network error')
  })

  // --- unlinkSkillFromAgent thunk ---
  it('unlinkSkillFromAgent clears selectedSkill on fulfilled', async () => {
    mockUnlinkFromAgent.mockResolvedValue({ success: true })

    const store = await createTestStore()
    const { selectSkill, unlinkSkillFromAgent } = await import('./skillsSlice')
    store.dispatch(selectSkill(sampleSkill))
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: sampleSymlink }),
    )

    expect(store.getState().skills.selectedSkill).toBeNull()
    expect(store.getState().skills.skillToUnlink).toBeNull()
    expect(store.getState().skills.unlinking).toBe(false)
  })

  it('unlinkSkillFromAgent sets error on failure response', async () => {
    mockUnlinkFromAgent.mockResolvedValue({
      success: false,
      error: 'Permission denied',
    })

    const store = await createTestStore()
    const { unlinkSkillFromAgent } = await import('./skillsSlice')
    await store.dispatch(
      unlinkSkillFromAgent({ skill: sampleSkill, symlink: sampleSymlink }),
    )

    expect(store.getState().skills.unlinking).toBe(false)
    expect(store.getState().skills.error).toBe('Permission denied')
  })

  // --- createSymlinks thunk ---
  it('createSymlinks clears skillToAddSymlinks on fulfilled', async () => {
    mockCreateSymlinks.mockResolvedValue({
      success: true,
      created: 2,
      failures: [],
    })

    const store = await createTestStore()
    const { setSkillToAddSymlinks, createSymlinks } =
      await import('./skillsSlice')
    store.dispatch(setSkillToAddSymlinks(sampleSkill))
    await store.dispatch(
      createSymlinks({
        skill: sampleSkill,
        agentIds: ['cursor' as AgentId, 'codex' as AgentId],
      }),
    )

    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
    expect(store.getState().skills.addingSymlinks).toBe(false)
  })

  it('createSymlinks sets error when all fail', async () => {
    mockCreateSymlinks.mockResolvedValue({
      success: false,
      created: 0,
      failures: ['cursor'],
    })

    const store = await createTestStore()
    const { createSymlinks } = await import('./skillsSlice')
    await store.dispatch(
      createSymlinks({ skill: sampleSkill, agentIds: ['cursor' as AgentId] }),
    )

    expect(store.getState().skills.error).toBe('Failed to create any symlinks')
  })

  // --- copyToAgents thunk ---
  it('copyToAgents clears skillToCopy on fulfilled', async () => {
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 1,
      failures: [],
    })

    const store = await createTestStore()
    const { setSkillToCopy, copyToAgents } = await import('./skillsSlice')
    store.dispatch(setSkillToCopy(sampleSkill))
    await store.dispatch(
      copyToAgents({
        skill: sampleSkill,
        linkPath: sampleSymlink.linkPath,
        agentIds: ['codex' as AgentId],
      }),
    )

    expect(store.getState().skills.skillToCopy).toBeNull()
    expect(store.getState().skills.copying).toBe(false)
  })

  it('copyToAgents sets error when all fail', async () => {
    mockCopyToAgents.mockResolvedValue({
      success: false,
      copied: 0,
      failures: ['codex'],
    })

    const store = await createTestStore()
    const { copyToAgents } = await import('./skillsSlice')
    await store.dispatch(
      copyToAgents({
        skill: sampleSkill,
        linkPath: sampleSymlink.linkPath,
        agentIds: ['codex' as AgentId],
      }),
    )

    expect(store.getState().skills.error).toBe('Failed to copy to any agent')
  })
})

describe('skillsSlice bulk selection reducers (v2.4)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('toggleSelection adds a name and sets the anchor', async () => {
    const { toggleSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('task'))
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().skills.selectionAnchor).toBe('task')
  })

  it('toggleSelection removes a name on the second toggle', async () => {
    const { toggleSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('task'))
    store.dispatch(toggleSelection('task'))
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    // Anchor remains — matches macOS Finder "last clicked row" semantics
    expect(store.getState().skills.selectionAnchor).toBe('task')
  })

  it('selectRange unions into existing selection preserving order', async () => {
    const { toggleSelection, selectRange } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('task'))
    store.dispatch(selectRange(['task', 'theme', 'browser']))

    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task',
      'theme',
      'browser',
    ])
    // Anchor advances to the last target of the range
    expect(store.getState().skills.selectionAnchor).toBe('browser')
  })

  it('selectRange does not duplicate names already selected', async () => {
    const { toggleSelection, selectRange } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('task'))
    store.dispatch(toggleSelection('browser'))
    store.dispatch(selectRange(['task', 'theme', 'browser']))

    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task',
      'browser',
      'theme',
    ])
  })

  it('selectAll replaces the entire selection', async () => {
    const { toggleSelection, selectAll } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('zebra'))
    store.dispatch(selectAll(['task', 'theme', 'browser']))

    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task',
      'theme',
      'browser',
    ])
    expect(store.getState().skills.selectionAnchor).toBe('browser')
  })

  it('selectAll with empty array clears selection and anchor', async () => {
    const { toggleSelection, selectAll } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('task'))
    store.dispatch(selectAll([]))

    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectionAnchor).toBeNull()
  })

  it('clearSelection resets names and anchor', async () => {
    const { toggleSelection, clearSelection } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(toggleSelection('task'))
    store.dispatch(toggleSelection('theme'))
    store.dispatch(clearSelection())

    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectionAnchor).toBeNull()
  })

  it('setBulkProgress sets and clears the progress counter', async () => {
    const { setBulkProgress } = await import('./skillsSlice')
    const store = await createTestStore()

    store.dispatch(setBulkProgress({ current: 3, total: 10 }))
    expect(store.getState().skills.bulkProgress).toEqual({
      current: 3,
      total: 10,
    })

    store.dispatch(setBulkProgress(null))
    expect(store.getState().skills.bulkProgress).toBeNull()
  })
})

describe('skillsSlice deleteSelectedSkills thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sets bulkDeleting and reconciles inFlightDeleteNames against live items on pending', async () => {
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
    // Include a ghost name that is NOT in state.items — reconciliation should drop it
    const promise = store.dispatch(
      deleteSelectedSkills(['task', 'theme-generator', 'already-gone']),
    )

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

  it('clears selection, anchor, inFlight, and progress on fulfilled', async () => {
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

    await store.dispatch(deleteSelectedSkills(['task']))

    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
    expect(state.bulkProgress).toBeNull()
  })

  it('clears in-flight and sets error on rejected', async () => {
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockDeleteSkills.mockRejectedValue(new Error('EACCES'))

    const { deleteSelectedSkills } = await import('./skillsSlice')
    await store.dispatch(deleteSelectedSkills(['task']))

    const state = store.getState().skills
    expect(state.bulkDeleting).toBe(false)
    expect(state.inFlightDeleteNames).toEqual([])
    expect(state.error).toBe('EACCES')
  })
})

describe('skillsSlice unlinkSelectedFromAgent thunk', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sets bulkUnlinking and reconciles inFlightUnlinkNames against live items on pending', async () => {
    const store = await createTestStore()
    await seedItems(store, [sampleSkill, secondSkill, thirdSkill])
    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )

    const { unlinkSelectedFromAgent } = await import('./skillsSlice')
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['task', 'browser', 'ghost'],
      }),
    )

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

  it('clears selection, anchor, and inFlight on fulfilled', async () => {
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [{ skillName: 'task', outcome: 'unlinked' }],
    } satisfies BulkUnlinkResult)

    const { unlinkSelectedFromAgent, toggleSelection } =
      await import('./skillsSlice')
    store.dispatch(toggleSelection('task'))

    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['task'],
      }),
    )

    const state = store.getState().skills
    expect(state.bulkUnlinking).toBe(false)
    expect(state.inFlightUnlinkNames).toEqual([])
    expect(state.selectedSkillNames).toEqual([])
    expect(state.selectionAnchor).toBeNull()
  })

  it('clears in-flight and sets error on rejected', async () => {
    const store = await createTestStore()
    await seedItems(store, [sampleSkill])
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Permission denied'))

    const { unlinkSelectedFromAgent } = await import('./skillsSlice')
    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['task'],
      }),
    )

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

  it('calls restoreDeletedSkill serially for each tombstone', async () => {
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
    await store.dispatch(undoLastBulkDelete(ids))

    expect(calls).toEqual(ids)
    expect(mockRestoreDeletedSkill).toHaveBeenCalledTimes(2)
  })

  it('returns per-item outcomes aligned with input order', async () => {
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
    const action = await store.dispatch(undoLastBulkDelete(ids))

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
  it('catches IPC rejection as per-item error outcome without slice-level error', async () => {
    mockRestoreDeletedSkill.mockRejectedValue(new Error('Disk full'))

    const store = await createTestStore()
    const { undoLastBulkDelete } = await import('./skillsSlice')
    const action = await store.dispatch(
      undoLastBulkDelete([tombstoneId('1-task-aaaaaaaa')]),
    )

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
