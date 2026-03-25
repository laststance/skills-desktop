import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Skill, SymlinkInfo } from '../../../../shared/types'

const mockGetAll = vi.fn()
const mockUnlinkFromAgent = vi.fn()
const mockDeleteSkill = vi.fn()
const mockCreateSymlinks = vi.fn()
const mockCopyToAgents = vi.fn()

vi.stubGlobal('window', {
  electron: {
    skills: {
      getAll: mockGetAll,
      unlinkFromAgent: mockUnlinkFromAgent,
      deleteSkill: mockDeleteSkill,
      createSymlinks: mockCreateSymlinks,
      copyToAgents: mockCopyToAgents,
    },
  },
})

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

/** Sample symlink info */
const sampleSymlink: SymlinkInfo = sampleSkill.symlinks[0]

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
  })

  // --- Sync reducers ---
  it('selectSkill sets selectedSkill', async () => {
    const { selectSkill } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(selectSkill(sampleSkill))
    expect(store.getState().skills.selectedSkill).toEqual(sampleSkill)

    store.dispatch(selectSkill(null))
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  it('setSkillToDelete sets and clears pending delete', async () => {
    const { setSkillToDelete } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(setSkillToDelete(sampleSkill))
    expect(store.getState().skills.skillToDelete).toEqual(sampleSkill)

    store.dispatch(setSkillToDelete(null))
    expect(store.getState().skills.skillToDelete).toBeNull()
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

  // --- deleteSkill thunk ---
  it('deleteSkill clears selectedSkill on fulfilled', async () => {
    mockDeleteSkill.mockResolvedValue({ success: true, symlinksRemoved: 2 })

    const store = await createTestStore()
    const { selectSkill, deleteSkill } = await import('./skillsSlice')
    store.dispatch(selectSkill(sampleSkill))
    await store.dispatch(deleteSkill(sampleSkill))

    expect(store.getState().skills.selectedSkill).toBeNull()
    expect(store.getState().skills.skillToDelete).toBeNull()
    expect(store.getState().skills.deleting).toBe(false)
  })

  it('deleteSkill sets error on failure', async () => {
    mockDeleteSkill.mockResolvedValue({
      success: false,
      error: 'Directory not found',
    })

    const store = await createTestStore()
    const { deleteSkill } = await import('./skillsSlice')
    await store.dispatch(deleteSkill(sampleSkill))

    expect(store.getState().skills.error).toBe('Directory not found')
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
        agentIds: ['cursor' as never, 'codex' as never],
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
      createSymlinks({ skill: sampleSkill, agentIds: ['cursor' as never] }),
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
        agentIds: ['codex' as never],
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
        agentIds: ['codex' as never],
      }),
    )

    expect(store.getState().skills.error).toBe('Failed to copy to any agent')
  })
})
