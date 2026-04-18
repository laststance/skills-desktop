import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { Skill, SkillName } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const mockGetAll = vi.fn()

beforeEach(() => {
  // Install the `electron` IPC bridge the preload normally exposes. In browser
  // mode Vitest reuses the Chromium page across tests in a file; `vi.stubGlobal`
  // paired with `vi.unstubAllGlobals()` in afterEach keeps the fake scoped.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: vi.fn(() => () => {}),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal Skill fixture.
 * @param overrides - Partial Skill overrides
 * @returns Complete Skill object
 * @example makeSkill({ name: 'browse' as SkillName })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'task' as SkillName,
    description: 'Task management skill',
    path: '/home/user/.agents/skills/task' as Skill['path'],
    symlinkCount: 0,
    symlinks: [],
    ...overrides,
  }
}

/**
 * Build a combined store with the slices SkillItem reads. Uses each slice's
 * own initialState so tests exercise real defaults without hand-crafting
 * every field.
 * @returns Redux store
 */
async function createStore() {
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('../../redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('../../redux/slices/agentsSlice')
  const { default: bookmarkReducer } =
    await import('../../redux/slices/bookmarkSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarkReducer,
    },
  })
}

/**
 * Render SkillItem inside the provider stack it needs (Redux + Tooltip).
 * @returns { screen, store } — screen exposes vitest-browser-react locators
 * like getByRole; store is the Redux store for dispatching setup actions.
 */
async function renderSkillItem(skill: Skill) {
  const store = await createStore()
  const { SkillItem } = await import('./SkillItem')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <SkillItem skill={skill} />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

describe('SkillItem bulk-select checkbox visibility', () => {
  it('hides the checkbox when bulkSelectMode=false (default clean list)', async () => {
    const { screen } = await renderSkillItem(makeSkill())

    // `.query()` returns the matched element or null synchronously. Using
    // this over `getBy(...).not.toBeInTheDocument()` avoids the strict-single-
    // match locator resolution error path, so a future regression that
    // accidentally renders a checkbox produces a clean "element is present"
    // failure instead of a locator-throw stack trace.
    expect(screen.getByRole('checkbox').query()).toBeNull()
  })

  it('renders the checkbox when bulkSelectMode=true', async () => {
    const { screen, store } = await renderSkillItem(makeSkill())
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())

    await expect.element(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('checkbox aria-label is "Select {name}" when not ticked', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())

    await expect
      .element(screen.getByRole('checkbox', { name: /Select task/i }))
      .toBeInTheDocument()
  })

  it('checkbox aria-label flips to "Deselect {name}" once ticked', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))

    await expect
      .element(screen.getByRole('checkbox', { name: /Deselect task/i }))
      .toBeInTheDocument()
  })

  it('exiting bulk mode removes the checkbox from the DOM', async () => {
    const { screen, store } = await renderSkillItem(makeSkill())
    const { enterBulkSelectMode, exitBulkSelectMode } =
      await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())
    await expect.element(screen.getByRole('checkbox')).toBeInTheDocument()

    store.dispatch(exitBulkSelectMode())
    // Poll until the checkbox unmounts — exit dispatch is sync but the
    // re-render that removes the node happens on the next commit cycle.
    await expect.poll(() => screen.getByRole('checkbox').query()).toBeNull()
  })
})
