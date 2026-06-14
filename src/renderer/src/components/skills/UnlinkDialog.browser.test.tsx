import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  FilesystemEntryIdentity,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'

const mockUnlinkFromAgent = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastWarning = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}))

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

/**
 * Build a minimal Skill fixture for unlink-dialog tests.
 * @param overrides - Partial Skill overrides.
 * @returns Complete Skill object.
 * @example makeSkill({ name: 'task' as SkillName })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'task' as SkillName,
    description: 'Task management skill',
    path: '/home/user/.agents/skills/task' as Skill['path'],
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
    ...overrides,
  }
}

/**
 * Build a minimal SymlinkInfo fixture for unlink-dialog tests.
 * @param overrides - Partial symlink overrides.
 * @returns Complete SymlinkInfo object.
 * @example makeSymlink({ status: 'valid' })
 */
function makeSymlink(overrides: Partial<SymlinkInfo> = {}): SymlinkInfo {
  return {
    agentId: 'cursor',
    agentName: 'Cursor',
    status: 'valid',
    targetPath: '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
    linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
    isLocal: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockUnlinkFromAgent.mockReset()
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  mockToastSuccess.mockReset()
  mockToastError.mockReset()
  mockToastWarning.mockReset()

  // refreshAllData fan-out fetches — keep them resolved so the post-unlink
  // refresh never rejects under the dialog.
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue({})

  vi.stubGlobal('electron', {
    skills: {
      unlinkFromAgent: mockUnlinkFromAgent,
      getAll: mockSkillsGetAll,
    },
    agents: {
      getAll: mockAgentsGetAll,
    },
    source: {
      getStats: mockSourceGetStats,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render UnlinkDialog with a real reducer store, then open it on a skill+symlink.
 * @param options.skill - Skill targeted by the dialog (omit to leave it closed).
 * @param options.symlink - Symlink record whose shape drives the variant copy.
 * @returns Render handle and Redux store.
 */
async function renderUnlinkDialog(
  options: {
    skill?: Skill
    symlink?: SymlinkInfo
  } = {},
) {
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { setSkillToUnlink } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { UnlinkDialog } = await import('./UnlinkDialog')

  const store = configureStore({
    reducer: {
      skills: skillsReducer,
      agents: agentsReducer,
      ui: uiReducer,
    },
  })

  const screen = await render(
    <Provider store={store}>
      <UnlinkDialog />
    </Provider>,
  )

  if (options.skill && options.symlink) {
    store.dispatch(
      setSkillToUnlink({ skill: options.skill, symlink: options.symlink }),
    )
  }

  return { screen, store }
}

describe('UnlinkDialog variant copy', () => {
  it('shows "Remove from Agent" copy for a live valid link', async () => {
    // Arrange
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'valid', agentName: 'Cursor' })

    // Act
    const { screen } = await renderUnlinkDialog({ skill, symlink })

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: /Remove from Agent/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(/will remain available for other agents/i))
      .toBeInTheDocument()
  })

  it('shows "Delete from Agent" trash copy for a local skill folder', async () => {
    // Arrange
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({
      isLocal: true,
      status: 'valid',
      filesystemIdentity: directoryIdentity,
    })

    // Act
    const { screen } = await renderUnlinkDialog({ skill, symlink })

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: /Delete from Agent/i }))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText(/move the local skill folder to the operating/i),
      )
      .toBeInTheDocument()
  })

  it('shows "Remove Broken Link" copy for a dangling broken symlink', async () => {
    // Arrange
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'broken', isLocal: false })

    // Act
    const { screen } = await renderUnlinkDialog({ skill, symlink })

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: /Remove Broken Link/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(/original skill source no longer exists/i))
      .toBeInTheDocument()
  })

  it('treats a missing symlink as broken-link cleanup copy', async () => {
    // Arrange
    // 'missing' is defensively mapped to the broken variant so it can never
    // fall through to the live-link "remove" copy.
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({
      status: 'missing',
      isLocal: false,
      targetPath: undefined,
    })

    // Act
    const { screen } = await renderUnlinkDialog({ skill, symlink })

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: /Remove Broken Link/i }))
      .toBeInTheDocument()
  })

  it('shows "Manual Review Required" copy for an inaccessible target', async () => {
    // Arrange
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'inaccessible', isLocal: false })

    // Act
    const { screen } = await renderUnlinkDialog({ skill, symlink })

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: /Manual Review Required/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(/target could not be verified/i))
      .toBeInTheDocument()
  })
})

describe('UnlinkDialog confirm action', () => {
  it('shows a success toast and clears the target after removing a valid link', async () => {
    // Arrange
    mockUnlinkFromAgent.mockResolvedValue({ success: true })
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'valid', agentName: 'Cursor' })
    const { screen, store } = await renderUnlinkDialog({ skill, symlink })
    await expect
      .element(screen.getByRole('dialog', { name: /Remove from Agent/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Remove$/i }).click()

    // Assert
    await expect
      .poll(() => mockToastSuccess.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockToastSuccess).toHaveBeenCalledWith('Removed from Cursor', {
      description: 'task is no longer linked to Cursor',
    })
    await expect.poll(() => store.getState().skills.skillToUnlink).toBeNull()
  })

  it('shows an error toast with the failure reason when removal fails', async () => {
    // Arrange
    mockUnlinkFromAgent.mockResolvedValue({
      success: false,
      error: 'EPERM: operation not permitted',
    })
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'valid', agentName: 'Cursor' })
    const { screen } = await renderUnlinkDialog({ skill, symlink })
    await expect
      .element(screen.getByRole('dialog', { name: /Remove from Agent/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Remove$/i }).click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBeGreaterThan(0)
    expect(mockToastError).toHaveBeenCalledWith('Failed to remove skill', {
      description: 'EPERM: operation not permitted',
    })
  })

  it('falls back to a generic error message when the failure carries no reason', async () => {
    // Arrange
    // A rejected thunk with no error message must still surface a toast so the
    // user is never left without feedback after a failed unlink.
    mockUnlinkFromAgent.mockRejectedValue(new Error())
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'valid', agentName: 'Cursor' })
    const { screen } = await renderUnlinkDialog({ skill, symlink })
    await expect
      .element(screen.getByRole('dialog', { name: /Remove from Agent/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Remove$/i }).click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBeGreaterThan(0)
    expect(mockToastError).toHaveBeenCalledWith('Failed to remove skill', {
      description: 'An unexpected error occurred',
    })
  })

  it('warns and never calls the IPC bridge for an inaccessible target on confirm', async () => {
    // Arrange
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'inaccessible', isLocal: false })
    const { screen, store } = await renderUnlinkDialog({ skill, symlink })
    await expect
      .element(screen.getByRole('dialog', { name: /Manual Review Required/i }))
      .toBeInTheDocument()

    // Act
    // Two elements share the accessible name "Close": the destructive confirm
    // button (footer, first in DOM) and the Radix dialog X. `.first()` targets
    // the confirm button that drives handleUnlink.
    await screen
      .getByRole('button', { name: /^Close$/i })
      .first()
      .click()

    // Assert
    await expect
      .poll(() => mockToastWarning.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockToastWarning).toHaveBeenCalledWith('Manual review required', {
      description:
        'task was not removed because its target could not be verified.',
    })
    expect(mockUnlinkFromAgent).not.toHaveBeenCalled()
    await expect.poll(() => store.getState().skills.skillToUnlink).toBeNull()
  })
})

describe('UnlinkDialog cancel behavior', () => {
  it('clears the unlink target when cancelled while idle', async () => {
    // Arrange
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'valid' })
    const { screen, store } = await renderUnlinkDialog({ skill, symlink })
    await expect
      .element(screen.getByRole('dialog', { name: /Remove from Agent/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Cancel$/i }).click()

    // Assert
    await expect.poll(() => store.getState().skills.skillToUnlink).toBeNull()
  })

  it('refuses to dismiss via Escape while a removal is already in flight', async () => {
    // Arrange
    // While unlinking is true the dialog must refuse to close so the user
    // cannot abandon an in-progress destructive operation.
    const skill = makeSkill({ name: 'task' as SkillName })
    const symlink = makeSymlink({ status: 'valid' })
    const { screen, store } = await renderUnlinkDialog({ skill, symlink })
    const { unlinkSkillFromAgent } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    // Drive the slice into the pending state without resolving the thunk so the
    // dialog renders in its loading guard.
    store.dispatch(unlinkSkillFromAgent.pending('req-id', { skill, symlink }))
    expect(store.getState().skills.unlinking).toBe(true)
    const dialog = screen.getByRole('dialog', { name: /Remove from Agent/i })
    await expect.element(dialog).toBeInTheDocument()

    // Act
    // Escape still routes through onOpenChange even though Cancel is disabled;
    // handleClose's `if (!unlinking)` guard must swallow it.
    dialog
      .element()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )

    // Assert — the guard means a close attempt during unlinking is a no-op;
    // the target stays set and the dialog stays mounted.
    expect(store.getState().skills.skillToUnlink).not.toBeNull()
    await expect.element(dialog).toBeInTheDocument()
  })
})
