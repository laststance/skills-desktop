import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { GSTACK_REPOSITORY_URL } from '../../../../shared/constants'
import type { Skill, SkillName } from '../../../../shared/types'
import { repositoryId } from '../../../../shared/types'
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

describe('SkillItem delete button — CLI vs plain routing', () => {
  // The X button in global view is the fork where `isCliManagedSkill(skill)`
  // decides whether the row enters the CLI remove dialog (irreversible) or
  // the shared trash+undo flow. Getting this wrong orphans `.skill-lock.json`
  // entries, so the branch is worth pinning down with explicit assertions.

  it('aria-label reads "Remove {name} via skills CLI" for a CLI-managed skill', async () => {
    const { screen } = await renderSkillItem(
      makeSkill({
        name: 'brainstorming' as SkillName,
        // `source` set → isCliManagedSkill → CLI path
        source: repositoryId('vercel-labs/agent-skills'),
      }),
    )

    await expect
      .element(
        screen.getByRole('button', {
          name: /Remove brainstorming via skills CLI/i,
        }),
      )
      .toBeInTheDocument()
  })

  it('aria-label reads "Delete {name}" for a plain (non-CLI) skill', async () => {
    const { screen } = await renderSkillItem(
      makeSkill({ name: 'local-skill' as SkillName }),
    )

    await expect
      .element(screen.getByRole('button', { name: /^Delete local-skill$/i }))
      .toBeInTheDocument()
  })

  it('clicking the X on a CLI skill dispatches setCliRemoveTarget([name])', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'brainstorming' as SkillName,
        source: repositoryId('vercel-labs/agent-skills'),
      }),
    )

    await screen
      .getByRole('button', { name: /Remove brainstorming via skills CLI/i })
      .click()

    // CLI path → cliRemoveTarget is set, bulkConfirm stays null. Asserting
    // both guards against future regressions where the handler accidentally
    // dispatches into the trash flow as well.
    expect(store.getState().skills.cliRemoveTarget).toEqual(['brainstorming'])
    expect(store.getState().ui.bulkConfirm).toBeNull()
  })

  it('clicking the X on a plain skill opens bulkConfirm (trash + undo path)', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'local-skill' as SkillName }),
    )

    await screen.getByRole('button', { name: /^Delete local-skill$/i }).click()

    // Plain path → bulkConfirm surfaces the trash+undo dialog, cliRemoveTarget
    // stays null. The payload shape must also match what BulkConfirmDialog
    // expects (kind='delete', no agent).
    const confirm = store.getState().ui.bulkConfirm
    expect(confirm).toEqual({
      kind: 'delete',
      skillNames: ['local-skill'],
      agentId: null,
      agentName: null,
    })
    expect(store.getState().skills.cliRemoveTarget).toBeNull()
  })

  it('X button click does not trigger inspector selection (stopPropagation)', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'brainstorming' as SkillName }),
    )

    await screen
      .getByRole('button', { name: /^Delete brainstorming$/i })
      .click()

    // If propagation leaked, the Card's onClick would fire `selectSkill(skill)`
    // and the inspector pane would open on the very skill we're deleting — an
    // obvious UX sin. The handler calls `e.stopPropagation()` specifically to
    // prevent this.
    expect(store.getState().skills.selectedSkill).toBeNull()
  })
})

describe('SkillItem Add button routing', () => {
  it('shows Add button in agent view when the skill exists in selected agent', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'valid',
            targetPath: '/home/user/.agents/skills/task',
            linkPath: '/home/user/.cursor/skills/task',
            isLocal: false,
          },
        ],
      }),
    )
    const { selectAgent } = await import('../../redux/slices/uiSlice')

    store.dispatch(selectAgent('cursor'))

    await expect
      .element(screen.getByRole('button', { name: /^Add$/i }))
      .toBeInTheDocument()
  })

  it('in agent view, Add click opens copy modal target (skillToCopy)', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'valid',
            targetPath: '/home/user/.agents/skills/task',
            linkPath: '/home/user/.cursor/skills/task',
            isLocal: false,
          },
        ],
      }),
    )
    const { selectAgent } = await import('../../redux/slices/uiSlice')

    store.dispatch(selectAgent('cursor'))
    await screen.getByRole('button', { name: /^Add$/i }).click()

    expect(store.getState().skills.skillToCopy?.name).toBe('task')
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
  })

  it('in global view, Add click keeps existing add-symlink routing', async () => {
    const { screen, store } = await renderSkillItem(makeSkill())

    await screen.getByRole('button', { name: /^Add$/i }).click()

    expect(store.getState().skills.skillToAddSymlinks?.name).toBe('task')
    expect(store.getState().skills.skillToCopy).toBeNull()
  })
})

describe('SkillItem G-Stack badge', () => {
  it('shows a G-Stack badge link in supported agent view for gstack-managed skills', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            targetPath: '/Users/me/.claude/skills/gstack/task',
            linkPath: '/Users/me/.claude/skills/task',
            isLocal: false,
          },
        ],
      }),
    )
    const { selectAgent } = await import('../../redux/slices/uiSlice')

    store.dispatch(selectAgent('claude-code'))

    const gstackLink = screen.getByRole('link', { name: /G-Stack/i })
    await expect.element(gstackLink).toBeInTheDocument()
    await expect
      .element(
        screen.getByRole('link', { name: /Open G-Stack GitHub repository/i }),
      )
      .toBeInTheDocument()
    await expect
      .element(gstackLink)
      .toHaveAttribute('href', GSTACK_REPOSITORY_URL)
  })

  it('hides the G-Stack badge in global view', async () => {
    const { screen } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            targetPath: '/Users/me/.claude/skills/gstack/task',
            linkPath: '/Users/me/.claude/skills/task',
            isLocal: false,
          },
        ],
      }),
    )

    expect(screen.getByRole('link', { name: /G-Stack/i }).query()).toBeNull()
  })
})

describe('SkillItem bulk-select checkbox stopPropagation', () => {
  // The checkbox wrapper `<label>` and the Checkbox itself both need to stop
  // propagation, otherwise Card's onClick (which toggles the Inspector pane)
  // fires alongside the toggle — a click on the checkbox would both tick AND
  // flip selectedSkill, which is never what the user wants.

  it('toggling the checkbox does not set selectedSkill', async () => {
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())
    await screen.getByRole('checkbox', { name: /Select task/i }).click()

    // Checkbox tick → selection updated in the skills slice, Inspector stays
    // closed. If stopPropagation regressed, selectedSkill would be set here.
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })
})
