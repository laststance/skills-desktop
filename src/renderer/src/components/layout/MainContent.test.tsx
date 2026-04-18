// @vitest-environment happy-dom
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillName } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const mockGetAll = vi.fn()
const mockShellOpenExternal = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})

/**
 * Short-circuit every heavy child MainContent renders so tests focus on the
 * toggle button and the document-level keyboard shortcuts this file owns.
 * Without these mocks the default render would drag in SkillsMarketplace,
 * SkillsList (which fetches via IPC on mount), six dialogs, and the UndoToast.
 */
vi.mock('../skills/SkillsList', () => ({
  SkillsList: () => null,
}))
vi.mock('../marketplace', () => ({
  SkillsMarketplace: () => null,
}))
vi.mock('../skills/SearchBox', () => ({
  SearchBox: () => null,
}))
vi.mock('../skills/SelectionToolbar', () => ({
  SelectionToolbar: () => null,
}))
vi.mock('../skills/UnlinkDialog', () => ({
  UnlinkDialog: () => null,
}))
vi.mock('../skills/AddSymlinkModal', () => ({
  AddSymlinkModal: () => null,
}))
vi.mock('../skills/CopyToAgentsModal', () => ({
  CopyToAgentsModal: () => null,
}))
vi.mock('../sidebar/SyncConfirmDialog', () => ({
  SyncConfirmDialog: () => null,
}))
vi.mock('../sidebar/SyncConflictDialog', () => ({
  SyncConflictDialog: () => null,
}))
vi.mock('../sidebar/SyncResultDialog', () => ({
  SyncResultDialog: () => null,
}))
vi.mock('../skills/UndoToast', () => ({
  UndoToast: () => null,
}))
vi.mock('../../redux/thunks', () => ({
  refreshAllData: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    custom: vi.fn(() => 'toast-id'),
    dismiss: vi.fn(),
  }),
}))

beforeEach(() => {
  mockGetAll.mockReset()
  mockShellOpenExternal.mockReset()
  mockOnDeleteProgress.mockReset()
  mockOnDeleteProgress.mockImplementation(() => () => {})
  // Stub only the `electron` global. happy-dom's globalThis IS the window, so
  // `window.electron` resolves to this value while `window.addEventListener`
  // and the rest of the Window prototype stay intact. Replacing `window`
  // via spread would drop prototype methods SkillItem and friends rely on.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
    },
    shell: {
      openExternal: mockShellOpenExternal,
    },
  })
})

afterEach(() => {
  // Without globals:true in vitest.config, @testing-library/react's auto-cleanup
  // doesn't register. Call cleanup() explicitly so each render mounts into a
  // fresh DOM — otherwise MainContents from prior tests stay mounted and the
  // document keydown listener fires multiple times per event.
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Build a combined store using each slice's own initialState so tests exercise
 * real defaults without hand-crafting every field. Tests that need non-default
 * state dispatch actions after rendering.
 * @returns Redux store wired with the slices MainContent reads
 */
async function createStore() {
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('../../redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('../../redux/slices/agentsSlice')
  const { default: bookmarksReducer } =
    await import('../../redux/slices/bookmarkSlice')
  const { default: marketplaceReducer } =
    await import('../../redux/slices/marketplaceSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarksReducer,
      marketplace: marketplaceReducer,
    },
  })
}

/**
 * Render MainContent inside its required provider stack (Redux + Tooltip).
 * @returns Rendered result + store for dispatching setup actions or asserting state
 */
async function renderMainContent() {
  const store = await createStore()
  const { MainContent } = await import('./MainContent')
  const utils = render(
    <Provider store={store}>
      <TooltipProvider>
        <MainContent />
      </TooltipProvider>
    </Provider>,
  )
  return { ...utils, store }
}

describe('MainContent bulk-select toggle button', () => {
  it('shows "Select" and aria-pressed=false by default', async () => {
    await renderMainContent()

    const toggleButton = screen.getByRole('button', {
      name: /Enter bulk select mode/i,
    })
    expect(toggleButton.textContent).toContain('Select')
    expect(toggleButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking "Select" enters bulk select mode', async () => {
    const { store } = await renderMainContent()

    const toggleButton = screen.getByRole('button', {
      name: /Enter bulk select mode/i,
    })
    fireEvent.click(toggleButton)

    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('after entering mode the label flips to "Cancel" and aria-pressed=true', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
    })

    const toggleButton = screen.getByRole('button', {
      name: /Exit bulk select mode/i,
    })
    expect(toggleButton.textContent).toContain('Cancel')
    expect(toggleButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking "Cancel" exits mode AND clears accumulated selection', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
      store.dispatch(toggleSelection('task' as SkillName))
      store.dispatch(toggleSelection('tdd' as SkillName))
    })
    expect(store.getState().skills.selectedSkillNames.length).toBe(2)

    const toggleButton = screen.getByRole('button', {
      name: /Exit bulk select mode/i,
    })
    fireEvent.click(toggleButton)

    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })
})

describe('MainContent keyboard shortcuts (Cmd+A)', () => {
  it('Cmd+A is a no-op when bulkSelectMode=false (guards against hidden selection)', async () => {
    const { store } = await renderMainContent()

    fireEvent.keyDown(document, { key: 'a', metaKey: true })

    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('Ctrl+A is also a no-op when bulkSelectMode=false', async () => {
    const { store } = await renderMainContent()

    fireEvent.keyDown(document, { key: 'a', ctrlKey: true })

    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('Cmd+A dispatches selectAll over visible names when bulkSelectMode=true', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: 'task' as SkillName,
        description: '',
        path: '/skills/task' as never,
        symlinkCount: 0,
        symlinks: [],
      },
      {
        name: 'tdd' as SkillName,
        description: '',
        path: '/skills/tdd' as never,
        symlinkCount: 0,
        symlinks: [],
      },
    ]

    // Seeding via the thunk's fulfilled action avoids mocking the IPC call
    // and exercises the real reducer path that fills `items` in production.
    // act() wraps setup so useEffect flushes and `bulkSelectModeRef.current`
    // sees the new mode before the keydown handler reads it.
    await act(async () => {
      store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
      store.dispatch(enterBulkSelectMode())
    })

    fireEvent.keyDown(document, { key: 'a', metaKey: true })

    const selectedNames = store.getState().skills.selectedSkillNames
    expect(selectedNames).toContain('task')
    expect(selectedNames).toContain('tdd')
    expect(selectedNames.length).toBe(2)
  })

  it('Cmd+A is ignored when focus is inside an editable target', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
    })

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)
    textInput.focus()
    fireEvent.keyDown(textInput, { key: 'a', metaKey: true })

    expect(store.getState().skills.selectedSkillNames).toEqual([])

    document.body.removeChild(textInput)
  })
})

describe('MainContent keyboard shortcuts (Esc 2-step)', () => {
  it('first Esc with non-empty selection clears selection only (mode stays on)', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
      store.dispatch(toggleSelection('task' as SkillName))
    })
    expect(store.getState().skills.selectedSkillNames.length).toBe(1)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('second Esc with empty selection exits bulk select mode', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('Esc is a no-op when bulkSelectMode=false', async () => {
    const { store } = await renderMainContent()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('Esc is ignored when focus is inside an editable target', async () => {
    const { store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
      store.dispatch(toggleSelection('task' as SkillName))
    })

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)
    textInput.focus()
    fireEvent.keyDown(textInput, { key: 'Escape' })

    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().ui.bulkSelectMode).toBe(true)

    document.body.removeChild(textInput)
  })
})
