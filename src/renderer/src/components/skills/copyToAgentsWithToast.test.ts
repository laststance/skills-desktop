import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyToAgents } from '@/renderer/src/redux/slices/skillsSlice'
import type { AbsolutePath, Skill, SkillName } from '@/shared/types'

// `copyToAgentsWithToast` is the shared "dispatch → match-fulfilled →
// 3-branch toast → refreshAllData" helper used by AddSymlinkModal and
// CopyToAgentsModal. The node lane has no window.electron and no React
// renderer, so we drive the real branching logic by: (1) stubbing the three
// sonner toast variants it can call, (2) mocking refreshAllData so the helper
// never reaches into the fetch thunks / IPC, and (3) handing a controllable
// dispatch the resolved redux action it should branch on. We keep the REAL
// `copyToAgents` action creator so `copyToAgents.fulfilled.match(...)` runs
// against genuine action types rather than a hand-faked matcher.

const toastWarningMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarningMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

// refreshAllData always runs on exit; stub it so the helper does not pull in
// the fetchSkills/fetchAgents/fetchSourceStats thunks (which need window.electron).
const refreshAllDataMock = vi.fn()
vi.mock('@/renderer/src/redux/thunks', () => ({
  refreshAllData: (...args: unknown[]) => refreshAllDataMock(...args),
}))

// Controllable dispatch: records the thunk call and returns the resolved action.
const dispatchMock = vi.fn()

/**
 * Builds a minimal Skill fixture; only `name` is read by the helper.
 * @param name - skill name surfaced in the success-toast description.
 * @returns Skill fixture sufficient for copyToAgentsWithToast unit tests.
 * @example makeSkill('tdd-workflow').name // => 'tdd-workflow'
 */
function makeSkill(name: SkillName = 'tdd-workflow'): Skill {
  return {
    name,
    description: `${name} description`,
    path: `/Users/test/.agents/skills/${name}`,
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
  }
}

const sampleSourcePath: AbsolutePath = '/Users/test/.agents/skills/tdd-workflow'

beforeEach(() => {
  toastWarningMock.mockClear()
  toastSuccessMock.mockClear()
  toastErrorMock.mockClear()
  refreshAllDataMock.mockClear()
  dispatchMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('copyToAgentsWithToast', () => {
  it('shows a success toast naming the skill when every agent copy succeeds', async () => {
    // Arrange — a fulfilled thunk with no per-agent failures.
    dispatchMock.mockResolvedValue({
      type: copyToAgents.fulfilled.type,
      payload: { skillName: 'tdd-workflow', copied: 2, failures: [] },
    })
    const { copyToAgentsWithToast } = await import('./copyToAgentsWithToast')

    // Act
    await copyToAgentsWithToast(dispatchMock, {
      skill: makeSkill('tdd-workflow'),
      sourcePath: sampleSourcePath,
      agentIds: ['claude-code', 'codex'],
    })

    // Assert — success copy only, no warning/error.
    expect(toastSuccessMock).toHaveBeenCalledTimes(1)
    expect(toastSuccessMock).toHaveBeenCalledWith('Copied to 2 agent(s)', {
      description: 'tdd-workflow copied successfully',
    })
    expect(toastWarningMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('warns with the per-agent failure breakdown on a partial copy', async () => {
    // Arrange — fulfilled but some agents failed.
    dispatchMock.mockResolvedValue({
      type: copyToAgents.fulfilled.type,
      payload: {
        skillName: 'tdd-workflow',
        copied: 1,
        failures: [
          { agentId: 'cursor', error: 'Already exists' },
          { agentId: 'codex', error: 'Permission denied' },
        ],
      },
    })
    const { copyToAgentsWithToast } = await import('./copyToAgentsWithToast')

    // Act
    await copyToAgentsWithToast(dispatchMock, {
      skill: makeSkill('tdd-workflow'),
      sourcePath: sampleSourcePath,
      agentIds: ['claude-code', 'cursor', 'codex'],
    })

    // Assert — warning toast with the joined failure descriptions.
    expect(toastWarningMock).toHaveBeenCalledTimes(1)
    expect(toastWarningMock).toHaveBeenCalledWith(
      'Copied to 1 agent(s), 2 failed',
      {
        description: 'cursor: Already exists, codex: Permission denied',
      },
    )
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('shows an error toast with the rejection message when the copy thunk rejects', async () => {
    // Arrange — a rejected thunk carrying a concrete error message.
    dispatchMock.mockResolvedValue({
      type: copyToAgents.rejected.type,
      error: { message: 'Failed to copy to any agent' },
    })
    const { copyToAgentsWithToast } = await import('./copyToAgentsWithToast')

    // Act
    await copyToAgentsWithToast(dispatchMock, {
      skill: makeSkill('tdd-workflow'),
      sourcePath: sampleSourcePath,
      agentIds: ['claude-code'],
    })

    // Assert — error toast surfaces the thunk's rejection reason.
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to copy skill', {
      description: 'Failed to copy to any agent',
    })
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastWarningMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic error description when the rejection has no message', async () => {
    // Arrange — a rejected action with no `error` field at all.
    dispatchMock.mockResolvedValue({
      type: copyToAgents.rejected.type,
    })
    const { copyToAgentsWithToast } = await import('./copyToAgentsWithToast')

    // Act
    await copyToAgentsWithToast(dispatchMock, {
      skill: makeSkill('tdd-workflow'),
      sourcePath: sampleSourcePath,
      agentIds: ['claude-code'],
    })

    // Assert — generic fallback copy is shown.
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to copy skill', {
      description: 'An unexpected error occurred',
    })
  })

  it('always refreshes the skills list on exit regardless of outcome', async () => {
    // Arrange — any fulfilled outcome.
    dispatchMock.mockResolvedValue({
      type: copyToAgents.fulfilled.type,
      payload: { skillName: 'tdd-workflow', copied: 1, failures: [] },
    })
    const { copyToAgentsWithToast } = await import('./copyToAgentsWithToast')

    // Act
    await copyToAgentsWithToast(dispatchMock, {
      skill: makeSkill('tdd-workflow'),
      sourcePath: sampleSourcePath,
      agentIds: ['claude-code'],
    })

    // Assert — refreshAllData runs with the same dispatch.
    expect(refreshAllDataMock).toHaveBeenCalledTimes(1)
    expect(refreshAllDataMock).toHaveBeenCalledWith(dispatchMock)
  })
})
