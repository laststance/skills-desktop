// @vitest-environment happy-dom
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Skill, SkillName } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const mockGetAll = vi.fn()

beforeEach(() => {
  // Stub only the `electron` global. happy-dom's globalThis IS the window, so
  // `window.electron` resolves to this value while `window.addEventListener`
  // and the rest of the Window prototype stay intact. Replacing `window`
  // itself via spread would drop everything on the prototype.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: vi.fn(() => () => {}),
    },
  })
})

afterEach(() => {
  // Without globals:true in vitest.config, @testing-library/react's auto-cleanup
  // afterEach doesn't register. Call cleanup() explicitly so each render mounts
  // into a fresh DOM — otherwise earlier tests' SkillItems accumulate and
  // queryByRole returns multi-match.
  cleanup()
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
 * @returns Rendered result + store so tests can dispatch extra setup actions.
 */
async function renderSkillItem(skill: Skill) {
  const store = await createStore()
  const { SkillItem } = await import('./SkillItem')
  const utils = render(
    <Provider store={store}>
      <TooltipProvider>
        <SkillItem skill={skill} />
      </TooltipProvider>
    </Provider>,
  )
  return { ...utils, store }
}

describe('SkillItem bulk-select checkbox visibility', () => {
  it('hides the checkbox when bulkSelectMode=false (default clean list)', async () => {
    await renderSkillItem(makeSkill())

    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders the checkbox when bulkSelectMode=true', async () => {
    const { store } = await renderSkillItem(makeSkill())
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
    })

    expect(screen.queryByRole('checkbox')).not.toBeNull()
  })

  it('checkbox aria-label is "Select {name}" when not ticked', async () => {
    const { store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    await act(async () => {
      store.dispatch(enterBulkSelectMode())
    })

    expect(
      screen.queryByRole('checkbox', { name: /Select task/i }),
    ).not.toBeNull()
  })

  it('checkbox aria-label flips to "Deselect {name}" once ticked', async () => {
    const { store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
      store.dispatch(toggleSelection('task' as SkillName))
    })

    expect(
      screen.queryByRole('checkbox', { name: /Deselect task/i }),
    ).not.toBeNull()
  })

  it('exiting bulk mode removes the checkbox from the DOM', async () => {
    const { store } = await renderSkillItem(makeSkill())
    const { enterBulkSelectMode, exitBulkSelectMode } =
      await import('../../redux/slices/uiSlice')

    await act(async () => {
      store.dispatch(enterBulkSelectMode())
    })
    expect(screen.queryByRole('checkbox')).not.toBeNull()

    await act(async () => {
      store.dispatch(exitBulkSelectMode())
    })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
