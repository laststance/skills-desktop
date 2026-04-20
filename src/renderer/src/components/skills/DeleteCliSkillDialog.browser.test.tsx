import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { CliRemoveSkillsResult, SkillName } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const mockSkillsCliRemoveBatch = vi.fn()
const mockGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()

// The dialog uses `sonner`'s top-level `toast.error` directly on thunk rejection
// and `settleCliRemoveBatch` routes through `toastCliRemoveBatchResult` which
// calls `toast.success/error/warning`. Sharing one mock object keeps the
// surface identical to production.
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}))

beforeEach(() => {
  mockSkillsCliRemoveBatch.mockReset()
  mockGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  toastWarning.mockReset()
  // `refreshAllData` dispatches fetchSkills/fetchAgents/fetchSourceStats after
  // every confirm — stubbed to resolve immediately so the dialog's async
  // confirm handler settles deterministically.
  mockGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue(null)
  vi.stubGlobal('electron', {
    skillsCli: {
      removeBatch: mockSkillsCliRemoveBatch,
    },
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
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
 * Real reducers — the dialog reads `state.skills.cliRemoveTarget` and
 * `state.skills.bulkCliRemoving`, both produced by `skillsSlice`. Using the
 * real slice keeps the test honest: if a future reducer change breaks the
 * pending→fulfilled flag flip, this test catches it.
 */
async function createStore() {
  const { default: skillsReducer } =
    await import('../../redux/slices/skillsSlice')
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')
  const { default: agentsReducer } =
    await import('../../redux/slices/agentsSlice')
  return configureStore({
    reducer: {
      skills: skillsReducer,
      ui: uiReducer,
      agents: agentsReducer,
    },
  })
}

async function renderDialog() {
  const store = await createStore()
  const { DeleteCliSkillDialog } = await import('./DeleteCliSkillDialog')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <DeleteCliSkillDialog />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

describe('DeleteCliSkillDialog visibility', () => {
  it('renders nothing while cliRemoveTarget is null', async () => {
    const { screen } = await renderDialog()

    // No dialog → no "Remove CLI-managed Skill" title. `.query()` returns null
    // instead of throwing, so the assertion passes cleanly for the default
    // closed state.
    expect(
      screen.getByRole('dialog', { name: /Remove CLI-managed Skill/i }).query(),
    ).toBeNull()
  })

  it('opens with singular title when cliRemoveTarget holds exactly one skill', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')

    store.dispatch(setCliRemoveTarget(['brainstorming' as SkillName]))

    await expect
      .element(
        screen.getByRole('dialog', { name: /Remove CLI-managed Skill/i }),
      )
      .toBeInTheDocument()
    // Singular title wins over plural — the dialog must not say "Skills".
    expect(
      screen
        .getByRole('dialog', { name: /Remove CLI-managed Skills/i })
        .query(),
    ).toBeNull()
  })

  it('opens with plural title when cliRemoveTarget holds multiple skills', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')

    store.dispatch(
      setCliRemoveTarget([
        'brainstorming' as SkillName,
        'theme-generator' as SkillName,
        'code-review' as SkillName,
      ]),
    )

    await expect
      .element(
        screen.getByRole('dialog', { name: /Remove CLI-managed Skills/i }),
      )
      .toBeInTheDocument()
    // Count rendered into the description body
    await expect.element(screen.getByText(/3/)).toBeInTheDocument()
  })
})

describe('DeleteCliSkillDialog confirm — happy path', () => {
  it('dispatches cliRemoveSelectedSkills and fires the success toast on all-removed result', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')
    const allRemoved: CliRemoveSkillsResult = {
      items: [{ skillName: 'brainstorming' as SkillName, outcome: 'removed' }],
    }
    mockSkillsCliRemoveBatch.mockResolvedValue(allRemoved)

    store.dispatch(setCliRemoveTarget(['brainstorming' as SkillName]))
    await screen.getByRole('button', { name: /^Remove$/ }).click()

    // Poll until the IPC mock has been called — the dialog's confirm handler
    // awaits the thunk which in turn awaits the IPC promise.
    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(1)
    expect(mockSkillsCliRemoveBatch.mock.calls[0][0]).toEqual({
      items: [{ skillName: 'brainstorming' }],
    })

    await expect.poll(() => toastSuccess.mock.calls.length).toBe(1)
    // Single-item success surfaces the name ("Removed brainstorming").
    expect(toastSuccess.mock.calls[0][0]).toBe('Removed brainstorming')

    // Dialog closes after confirm (cliRemoveTarget cleared via setCliRemoveTarget(null))
    await expect
      .poll(() =>
        screen
          .getByRole('dialog', { name: /Remove CLI-managed Skill/i })
          .query(),
      )
      .toBeNull()
  })

  it('surfaces the failure toast when every batch item errors', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')
    const allFailed: CliRemoveSkillsResult = {
      items: [
        {
          skillName: 'brainstorming' as SkillName,
          outcome: 'error',
          error: { message: 'Skill not found in lock file', code: 1 },
        },
      ],
    }
    mockSkillsCliRemoveBatch.mockResolvedValue(allFailed)

    store.dispatch(setCliRemoveTarget(['brainstorming' as SkillName]))
    await screen.getByRole('button', { name: /^Remove$/ }).click()

    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(1)
    // Single-item error surfaces "Failed to remove {name}" — asserting the
    // exact toast copy ensures sanitisation of the CLI error message still
    // flows through the batch toast helper.
    await expect.poll(() => toastError.mock.calls.length).toBe(1)
    expect(toastError.mock.calls[0][0]).toBe('Failed to remove brainstorming')
  })

  it('fires Batch CLI remove failed toast when the thunk itself rejects', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')
    // IPC rejection (transport-level, not per-item error) routes to the
    // thunk's rejected branch — `toast.error` fires with the thunk error
    // rather than the batch-result toast helper.
    mockSkillsCliRemoveBatch.mockRejectedValue(new Error('IPC channel closed'))

    store.dispatch(
      setCliRemoveTarget([
        'brainstorming' as SkillName,
        'code-review' as SkillName,
      ]),
    )
    await screen.getByRole('button', { name: /^Remove$/ }).click()

    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(1)
    await expect.poll(() => toastError.mock.calls.length).toBe(1)
    // Batch copy wins because the target was length-2
    expect(toastError.mock.calls[0][0]).toBe('Batch CLI remove failed')
  })
})

describe('DeleteCliSkillDialog confirm — batch path', () => {
  it('dispatches removeBatch with every queued skill name', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')
    const partial: CliRemoveSkillsResult = {
      items: [
        { skillName: 'brainstorming' as SkillName, outcome: 'removed' },
        { skillName: 'theme-generator' as SkillName, outcome: 'removed' },
        {
          skillName: 'code-review' as SkillName,
          outcome: 'error',
          error: { message: 'Skill not found', code: 1 },
        },
      ],
    }
    mockSkillsCliRemoveBatch.mockResolvedValue(partial)

    store.dispatch(
      setCliRemoveTarget([
        'brainstorming' as SkillName,
        'theme-generator' as SkillName,
        'code-review' as SkillName,
      ]),
    )
    await screen.getByRole('button', { name: /^Remove$/ }).click()

    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(1)
    // All three names forwarded in order. Order matters: the CLI processes
    // them serially and the toast's "N of M" math assumes the server honoured
    // the array shape the thunk produced.
    expect(mockSkillsCliRemoveBatch.mock.calls[0][0]).toEqual({
      items: [
        { skillName: 'brainstorming' },
        { skillName: 'theme-generator' },
        { skillName: 'code-review' },
      ],
    })
    // Partial-success path → warning toast, not success or error
    await expect.poll(() => toastWarning.mock.calls.length).toBe(1)
    expect(toastWarning.mock.calls[0][0]).toBe('Removed 2, failed 1')
  })
})

describe('DeleteCliSkillDialog close guards', () => {
  it('clicking Cancel while idle closes the dialog', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget } =
      await import('../../redux/slices/skillsSlice')

    store.dispatch(setCliRemoveTarget(['brainstorming' as SkillName]))
    await expect.element(screen.getByRole('dialog')).toBeInTheDocument()

    await screen.getByRole('button', { name: /Cancel/ }).click()

    // Cancel path clears `cliRemoveTarget` → dialog unmounts.
    await expect.poll(() => screen.getByRole('dialog').query()).toBeNull()
    expect(store.getState().skills.cliRemoveTarget).toBeNull()
    // IPC never fired — Cancel is a pure-UI action.
    expect(mockSkillsCliRemoveBatch).not.toHaveBeenCalled()
  })

  it('Cancel button is disabled while bulkCliRemoving is true (prevents double-dismiss)', async () => {
    const { screen, store } = await renderDialog()
    const { setCliRemoveTarget, cliRemoveSelectedSkills } =
      await import('../../redux/slices/skillsSlice')

    // Hold the IPC promise open so the thunk stays in .pending — this is
    // exactly the state in which Cancel must be disabled. Without the hold,
    // the promise resolves before the assertion runs and the dialog closes.
    let resolveIpc: (value: CliRemoveSkillsResult) => void = () => {}
    mockSkillsCliRemoveBatch.mockReturnValue(
      new Promise<CliRemoveSkillsResult>((resolve) => {
        resolveIpc = resolve
      }),
    )

    store.dispatch(setCliRemoveTarget(['brainstorming' as SkillName]))
    // Fire the thunk via the store directly so we can assert the interim
    // state without races against a click handler.
    const pending = store.dispatch(
      cliRemoveSelectedSkills(['brainstorming' as SkillName]),
    )

    // `.pending` flip is synchronous after dispatch
    expect(store.getState().skills.bulkCliRemoving).toBe(true)

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await expect.element(cancelButton).toBeDisabled()

    // Resolve and wait — the afterEach would otherwise leak an unresolved
    // promise across the reused Chromium page.
    resolveIpc({ items: [] })
    await pending
  })
})
