import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { GSTACK_REPOSITORY_URL } from '@/shared/constants'
import type {
  FilesystemEntryIdentity,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'
import { repositoryId } from '@/shared/types'

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

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

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
    filesystemIdentity: directoryIdentity,
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
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
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: bookmarkReducer } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')
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
  it('hides the bulk-select checkbox in a normal clean list', async () => {
    // Arrange
    const { screen } = await renderSkillItem(makeSkill())

    // Act
    // (no interaction — bulk select mode is off by default)

    // Assert
    // `.query()` returns the matched element or null synchronously. Using
    // this over `getBy(...).not.toBeInTheDocument()` avoids the strict-single-
    // match locator resolution error path, so a future regression that
    // accidentally renders a checkbox produces a clean "element is present"
    // failure instead of a locator-throw stack trace.
    expect(screen.getByRole('checkbox').query()).toBeNull()
  })

  it('reveals the bulk-select checkbox after entering bulk select mode', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(makeSkill())
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(enterBulkSelectMode())

    // Assert
    await expect.element(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('labels the unticked bulk checkbox "Select {name}" for screen readers', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(enterBulkSelectMode())

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: /Select task/i }))
      .toBeInTheDocument()
  })

  it('flips the checkbox label to "Deselect {name}" once the skill is ticked', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: /Deselect task/i }))
      .toBeInTheDocument()
  })

  it('removes the bulk-select checkbox when exiting bulk select mode', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(makeSkill())
    const { enterBulkSelectMode, exitBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(enterBulkSelectMode())
    await expect.element(screen.getByRole('checkbox')).toBeInTheDocument()

    // Act
    store.dispatch(exitBulkSelectMode())

    // Assert
    // Poll until the checkbox unmounts — exit dispatch is sync but the
    // re-render that removes the node happens on the next commit cycle.
    await expect.poll(() => screen.getByRole('checkbox').query()).toBeNull()
  })
})

describe('SkillItem symlink status badges', () => {
  it('shows inaccessible slots instead of treating them as unlinked', async () => {
    // Arrange
    const inaccessibleSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'inaccessible',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
    })

    // Act
    const { screen } = await renderSkillItem(inaccessibleSkill)

    // Assert
    await expect
      .element(screen.getByLabelText('Inaccessible: 1'))
      .toBeInTheDocument()
    expect(screen.getByText('Not linked to any agent').query()).toBeNull()
  })

  it('hides the normal unlink button for inaccessible slots in agent view', async () => {
    // Arrange
    const inaccessibleSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'inaccessible',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(inaccessibleSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))

    // Assert
    await expect
      .element(
        screen.getByLabelText('Inaccessible link - manual review required'),
      )
      .toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Unlink task from/i }).query(),
    ).toBeNull()
  })

  it('hides the normal unlink button for broken slots in agent view', async () => {
    // Arrange
    const brokenSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
        {
          agentId: 'codex',
          agentName: 'Codex',
          status: 'valid',
          linkPath: '/home/user/.codex/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
      isOrphan: false,
    })
    const { screen, store } = await renderSkillItem(brokenSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    await expect.element(screen.getByLabelText('Broken: 1')).toBeInTheDocument()

    // Act
    store.dispatch(selectAgent('cursor'))

    // Assert
    await expect
      .poll(() => screen.getByLabelText('Broken: 1').query())
      .toBeNull()
    await expect
      .poll(() =>
        screen.getByRole('button', { name: /^Unlink task from/i }).query(),
      )
      .toBeNull()
    await expect
      .poll(() => screen.getByRole('button', { name: 'Add' }).query())
      .toBeNull()
  })

  it('hides Add for inaccessible slots so copy routing cannot fan out', async () => {
    // Arrange
    const inaccessibleSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'inaccessible',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(inaccessibleSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))

    // Assert
    await expect
      .element(
        screen.getByLabelText('Inaccessible link - manual review required'),
      )
      .toBeInTheDocument()
    await expect
      .poll(() => screen.getByRole('button', { name: /^Add$/i }).query())
      .toBeNull()
  })

  it('renders a disabled checkbox for broken agent rows that cannot use generic unlink', async () => {
    // Arrange
    const brokenSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
      isOrphan: true,
    })
    const { screen, store } = await renderSkillItem(brokenSkill)
    const { enterBulkSelectMode, selectAgent } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    store.dispatch(enterBulkSelectMode())

    // Assert — the slot stays rendered (so titles stay aligned) but the row is
    // marked out-of-scope via a disabled checkbox and an "is not eligible"
    // label, instead of vanishing. Keeping the checkbox lets a row that was
    // selected and then became ineligible still be deselected individually.
    const ineligibleCheckbox = screen.getByRole('checkbox', {
      name: 'task is not eligible for bulk selection',
    })
    await expect.element(ineligibleCheckbox).toBeInTheDocument()
    await expect.element(ineligibleCheckbox).toBeDisabled()
  })
})

describe('SkillItem delete button', () => {
  // Every skill — including ones tracked in `~/.agents/.skill-lock.json` via a
  // `source` field — opens the same trash + UndoToast dialog. The CLI removal
  // fork was retired (npx skills spawn was unreliable for ~/.agents/skills);
  // stale lock-file entries are the accepted trade-off.

  it('offers a "Delete {name}" button for a source-tracked skill', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({
        name: 'brainstorming' as SkillName,
        source: repositoryId('vercel-labs/agent-skills'),
      }),
    )

    // Act
    // (no interaction — assert the delete affordance is present)

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /^Delete brainstorming$/i }))
      .toBeInTheDocument()
  })

  it('offers a "Delete {name}" button for a plain skill', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({ name: 'local-skill' as SkillName }),
    )

    // Act
    // (no interaction — assert the delete affordance is present)

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /^Delete local-skill$/i }))
      .toBeInTheDocument()
  })

  it('opens the trash confirm dialog when deleting a source-tracked skill', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'brainstorming' as SkillName,
        source: repositoryId('vercel-labs/agent-skills'),
      }),
    )

    // Act
    await screen
      .getByRole('button', { name: /^Delete brainstorming$/i })
      .click()

    // Assert
    // Same trash + UndoToast dialog as plain skills — the handler no longer
    // forks on whether the skill is source-tracked. The payload shape must
    // match what BulkConfirmDialog expects (kind='delete', no agent).
    expect(store.getState().ui.bulkConfirm).toEqual({
      kind: 'delete',
      skillNames: ['brainstorming'],
      agentId: null,
      agentName: null,
      // Single-row delete carries no repo-filter scope, so the summary is null.
      sourceSummary: null,
      deleteTargets: [
        {
          skillName: 'brainstorming',
          skillPath: '/home/user/.agents/skills/task',
          filesystemIdentity: directoryIdentity,
        },
      ],
      orphanRecords: [],
      staleDeleteErrors: [],
      orphanErrors: [],
    })
  })

  it('opens the trash confirm dialog when deleting a plain skill', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'local-skill' as SkillName }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete local-skill$/i }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toEqual({
      kind: 'delete',
      skillNames: ['local-skill'],
      agentId: null,
      agentName: null,
      // Single-row delete carries no repo-filter scope, so the summary is null.
      sourceSummary: null,
      deleteTargets: [
        {
          skillName: 'local-skill',
          skillPath: '/home/user/.agents/skills/task',
          filesystemIdentity: directoryIdentity,
        },
      ],
      orphanRecords: [],
      staleDeleteErrors: [],
      orphanErrors: [],
    })
  })

  it('does not open the inspector pane when the delete button is clicked', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'brainstorming' as SkillName }),
    )

    // Act
    await screen
      .getByRole('button', { name: /^Delete brainstorming$/i })
      .click()

    // Assert
    // If propagation leaked, the Card's onClick would fire `selectSkill(skill)`
    // and the inspector pane would open on the very skill we're deleting — an
    // obvious UX sin. The handler calls `e.stopPropagation()` specifically to
    // prevent this.
    expect(store.getState().skills.selectedSkill).toBeNull()
  })
})

describe('SkillItem Add button routing', () => {
  it('keeps Add out of the row heading so screen readers announce only the skill name', async () => {
    // Arrange
    const { screen } = await renderSkillItem(makeSkill())

    // Act
    const headingWithAction = screen.getByRole('heading', {
      name: /task Add/i,
    })

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: /^task$/i }))
      .toBeInTheDocument()
    expect(headingWithAction.query()).toBeNull()
    await expect
      .element(screen.getByRole('button', { name: /^Add$/i }))
      .toBeInTheDocument()
  })

  it('shows the Add button in agent view when the skill exists in the selected agent', async () => {
    // Arrange
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
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /^Add$/i }))
      .toBeInTheDocument()
  })

  it('opens the copy-to-agent modal when Add is clicked in agent view', async () => {
    // Arrange
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
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    await screen.getByRole('button', { name: /^Add$/i }).click()

    // Assert
    expect(store.getState().skills.skillToCopy?.name).toBe('task')
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
  })

  it('opens the add-symlink modal when Add is clicked in global view', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(makeSkill())

    // Act
    await screen.getByRole('button', { name: /^Add$/i }).click()

    // Assert
    expect(store.getState().skills.skillToAddSymlinks?.name).toBe('task')
    expect(store.getState().skills.skillToCopy).toBeNull()
  })
})

describe('SkillItem G-Stack badge', () => {
  it('shows a G-Stack badge link in supported agent view for gstack-managed skills', async () => {
    // Arrange
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
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('claude-code'))

    // Assert
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
    // Arrange
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

    // Act
    // (no agent selected — global view is the default)

    // Assert
    expect(screen.getByRole('link', { name: /G-Stack/i }).query()).toBeNull()
  })

  it('shows badge for gstack-managed sibling skills (local skill whose SKILL.md symlinks into gstack)', async () => {
    // Arrange
    // Real production scenario: ~/.claude/skills/ship/ is a real directory
    // whose only entry is a SKILL.md symlink → ~/.claude/skills/gstack/ship/SKILL.md.
    // The skill's linkPath/targetPath alone do NOT contain "gstack" — only
    // the new skillMdSymlinkTarget field does. Without it, the badge is
    // hidden on every gstack sibling, which is the whole bug being fixed.
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'ship' as SkillName,
        path: '/Users/me/.claude/skills/ship' as Skill['path'],
        isSource: false,
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            linkPath: '/Users/me/.claude/skills/ship',
            isLocal: true,
            skillMdSymlinkTarget:
              '/Users/me/.claude/skills/gstack/ship/SKILL.md' as SymlinkInfo['skillMdSymlinkTarget'],
          },
        ],
      }),
    )
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('claude-code'))

    // Assert
    const gstackLink = screen.getByRole('link', { name: /G-Stack/i })
    await expect.element(gstackLink).toBeInTheDocument()
    await expect
      .element(gstackLink)
      .toHaveAttribute('href', GSTACK_REPOSITORY_URL)
  })

  it('hides the badge when skillMdSymlinkTarget points outside the gstack tree', async () => {
    // Arrange
    // Negative coverage at the wired-up SkillItem level: a local skill with
    // skillMdSymlinkTarget set but pointing at a user-managed path (no
    // `gstack` segment) must NOT receive the badge. The pure helper covers
    // this case in isolation, but a regression where someone fed
    // skillMdSymlinkTarget straight into the JSX (bypassing the helper)
    // would only surface here.
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'custom' as SkillName,
        path: '/Users/me/.claude/skills/custom' as Skill['path'],
        isSource: false,
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            linkPath: '/Users/me/.claude/skills/custom',
            isLocal: true,
            skillMdSymlinkTarget:
              '/Users/me/projects/my-skills/custom/SKILL.md' as SymlinkInfo['skillMdSymlinkTarget'],
          },
        ],
      }),
    )
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('claude-code'))

    // Assert
    expect(screen.getByRole('link', { name: /G-Stack/i }).query()).toBeNull()
  })
})

describe('SkillItem bulk-select checkbox stopPropagation', () => {
  // The checkbox wrapper `<label>` and the Checkbox itself both need to stop
  // propagation, otherwise Card's onClick (which toggles the Inspector pane)
  // fires alongside the toggle — a click on the checkbox would both tick AND
  // flip selectedSkill, which is never what the user wants.

  it('ticks the row for bulk select without opening the inspector pane', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(enterBulkSelectMode())
    await screen.getByRole('checkbox', { name: /Select task/i }).click()

    // Assert
    // Checkbox tick → selection updated in the skills slice, Inspector stays
    // closed. If stopPropagation regressed, selectedSkill would be set here.
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  it('extends the selection to the whole range on a shift-click with an existing anchor', async () => {
    // Arrange
    // Seed three visible rows so the range slice is meaningful, then plant an
    // anchor on 'alpha' (toggleSelection records the anchor). The rendered row
    // is the middle one ('task'); a shift-click on it should sweep alpha→task.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill({ name: 'alpha' as SkillName }),
          makeSkill({ name: 'task' as SkillName }),
          makeSkill({ name: 'zeta' as SkillName }),
        ],
        'req-id',
      ),
    )
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('alpha' as SkillName))
    // Precondition: anchor planted, so the shift branch will actually run.
    expect(store.getState().skills.selectionAnchor).toBe('alpha')

    // Act
    // `.click()` can't carry the shift modifier and Radix swallows it before
    // onClick, so fire the raw pointerdown the handler captures.
    const checkboxLocator = screen.getByRole('checkbox', {
      name: /^Select task$/i,
    })
    await expect.element(checkboxLocator).toBeInTheDocument()
    checkboxLocator
      .element()
      .dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }),
      )

    // Assert
    // Range covers alpha (anchor) through task (clicked) inclusive — zeta is
    // outside the slice. alpha was already ticked, task is newly added.
    await expect
      .poll(() => store.getState().skills.selectedSkillNames)
      .toEqual(['alpha', 'task'])
  })
})

describe('SkillItem unlink button', () => {
  it('stages the symlink for removal when unlinking a valid skill in agent view', async () => {
    // Arrange
    const validSkill = makeSkill({
      name: 'task' as SkillName,
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(validSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    // The agent display name comes from the agents slice (empty in this store),
    // so the button falls back to the generic "agent" label.
    await screen
      .getByRole('button', { name: /^Unlink task from agent$/i })
      .click()

    // Assert
    // The X routes the selected agent's symlink into the UnlinkDialog via the
    // skills slice; the staged payload must carry both skill and symlink.
    expect(store.getState().skills.skillToUnlink?.skill.name).toBe('task')
    expect(store.getState().skills.skillToUnlink?.symlink.agentId).toBe(
      'cursor',
    )
    // stopPropagation keeps the inspector closed on the row being unlinked.
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  it('stages the local-folder slot for removal when deleting a local skill in agent view', async () => {
    // Arrange
    // A real local folder (isLocal: true) in the selected agent's skills dir
    // has no source symlink, so handleUnlinkClick must fall back to
    // selectedLocalSkillInfo. The X button reads "Delete ... from ...".
    const localSkill = makeSkill({
      name: 'task' as SkillName,
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          isLocal: true,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(localSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    // Local skills surface as a "Delete ... from ..." affordance; the agents
    // slice is empty in this store, so the label falls back to "agent".
    await screen
      .getByRole('button', { name: /^Delete task from agent$/i })
      .click()

    // Assert
    // The fallback path stages the LOCAL slot itself (isLocal true) so the
    // UnlinkDialog removes the real folder rather than a non-existent symlink.
    expect(store.getState().skills.skillToUnlink?.skill.name).toBe('task')
    expect(store.getState().skills.skillToUnlink?.symlink.agentId).toBe(
      'cursor',
    )
    expect(store.getState().skills.skillToUnlink?.symlink.isLocal).toBe(true)
    // stopPropagation keeps the inspector closed on the row being deleted.
    expect(store.getState().skills.selectedSkill).toBeNull()
  })
})

describe('SkillItem bookmark toggle', () => {
  it('bookmarks an unbookmarked skill with its repo and url', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'task' as SkillName,
        source: repositoryId('vercel-labs/agent-skills'),
        sourceUrl: 'https://github.com/vercel-labs/agent-skills.git',
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Bookmark task$/i }).click()

    // Assert
    // addBookmark stores the derived repo + .git-stripped url so the Marketplace
    // tab can re-offer the source later. (bookmarkedAt is stamped by the reducer
    // and intentionally left out of the assertion.)
    const bookmarks = store.getState().bookmarks.items
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0].name).toBe('task')
    expect(bookmarks[0].repo).toBe('vercel-labs/agent-skills')
    expect(bookmarks[0].url).toBe('https://github.com/vercel-labs/agent-skills')
  })

  it('removes the bookmark when toggling an already-bookmarked skill', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'task' as SkillName,
        source: repositoryId('vercel-labs/agent-skills'),
      }),
    )
    const { addBookmark } =
      await import('@/renderer/src/redux/slices/bookmarkSlice')
    store.dispatch(
      addBookmark({
        name: 'task' as SkillName,
        repo: repositoryId('vercel-labs/agent-skills'),
        url: 'https://github.com/vercel-labs/agent-skills',
      }),
    )

    // Act
    await screen
      .getByRole('button', { name: /^Remove bookmark from task$/i })
      .click()

    // Assert
    expect(store.getState().bookmarks.items).toEqual([])
  })
})

describe('SkillItem card click', () => {
  it('opens the inspector pane on the clicked skill when the card body is clicked', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: 'task' as SkillName,
        description: 'Task management skill',
      }),
    )

    // Act
    // Click a non-button part of the card so the Card's onClick (not a child
    // action) is what fires.
    await screen.getByText('Task management skill').click()

    // Assert
    expect(store.getState().skills.selectedSkill?.name).toBe('task')
  })
})

describe('SkillItem G-Stack badge click', () => {
  it('keeps the inspector closed when the G-Stack badge is clicked', async () => {
    // Arrange
    // The badge is a real anchor; in agent view its onClick stops propagation
    // so the row's Card onClick (inspector select) never fires. Block the
    // anchor's default navigation for the duration so target=_blank cannot
    // open a popup in the test runner.
    const preventNavigation = (event: Event): void => event.preventDefault()
    document.addEventListener('click', preventNavigation, { capture: true })
    try {
      const { screen, store } = await renderSkillItem(
        makeSkill({
          name: 'task' as SkillName,
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
      const { selectAgent } =
        await import('@/renderer/src/redux/slices/uiSlice')
      store.dispatch(selectAgent('claude-code'))

      // Act
      // The anchor's aria-label ("Open G-Stack GitHub repository") is its
      // accessible name; match a substring of it.
      await screen
        .getByRole('link', { name: /Open G-Stack GitHub repository/i })
        .click()

      // Assert
      // stopPropagation on the badge keeps the Card onClick from selecting the
      // skill — clicking the external link must not also open the inspector.
      expect(store.getState().skills.selectedSkill).toBeNull()
    } finally {
      document.removeEventListener('click', preventNavigation, {
        capture: true,
      })
    }
  })
})

describe('SkillItem copy context menu', () => {
  it('stages the skill for copy when "Copy to..." is chosen from the right-click menu', async () => {
    // Arrange
    // Copy is only offered in agent view for a usable (valid, non-local) skill.
    const validSkill = makeSkill({
      name: 'task' as SkillName,
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: '/home/user/.cursor/skills/task' as SymlinkInfo['linkPath'],
          targetPath:
            '/home/user/.agents/skills/task' as SymlinkInfo['targetPath'],
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(validSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(selectAgent('cursor'))
    // Wait for the agent-view re-render to commit before firing contextmenu —
    // handleContextMenu closes over showCopyButton, which only flips true once
    // the agent-view render lands.
    await expect
      .element(screen.getByRole('button', { name: /^Add$/i }))
      .toBeInTheDocument()
    // Right-click a stable child (the description) — the contextmenu event
    // bubbles up to the Card's onContextMenu regardless of which child owns it.
    const card = screen.getByText('Task management skill').element()

    // Act
    // Right-click opens the controlled DropdownMenu (contextOpen state), then
    // choose the only item.
    card.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    await screen.getByRole('menuitem', { name: /Copy to/i }).click()

    // Assert
    expect(store.getState().skills.skillToCopy?.name).toBe('task')
  })

  it('does not open the right-click menu for a skill that cannot be copied', async () => {
    // Arrange
    // Global view: showCopyButton is false, so onContextMenu returns early and
    // no menu item is ever rendered.
    const { screen } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const card = screen.getByText('Task management skill').element()

    // Act
    card.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )

    // Assert
    expect(
      screen.getByRole('menuitem', { name: /Copy to/i }).query(),
    ).toBeNull()
  })
})

describe('SkillItem partial-failure flash', () => {
  it('flashes a red left edge for the matching row then clears it after the timeout', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { flashFailedRows } =
      await import('@/renderer/src/utils/bulkOpVisuals')
    const card = screen.getByText('Task management skill').element()
    // Walk up to the Card root that carries the data-skill-name + edge classes.
    const cardRoot = card.closest('[data-skill-name="task"]')
    expect(cardRoot).not.toBeNull()

    // Act
    // Fire the per-row failure event MainContent uses after a partial bulk op.
    flashFailedRows(['task' as SkillName])

    // Assert
    // The red edge appears immediately for this row's name...
    await expect
      .poll(() => cardRoot?.className.includes('border-l-red-500/70'))
      .toBe(true)
    // ...and the 3s timer clears it again (real timer — this test runs ~3s).
    await expect
      .poll(() => cardRoot?.className.includes('border-l-red-500/70'), {
        timeout: 5_000,
      })
      .toBe(false)
  })

  it('ignores a failure event addressed to a different row', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({ name: 'task' as SkillName }),
    )
    const { flashFailedRows } =
      await import('@/renderer/src/utils/bulkOpVisuals')
    const card = screen.getByText('Task management skill').element()
    const cardRoot = card.closest('[data-skill-name="task"]')

    // Act
    // A different skill's failure must not paint this row red (early return on
    // the skillName guard).
    flashFailedRows(['other-skill' as SkillName])

    // Assert
    await expect
      .poll(() => cardRoot?.className.includes('border-l-red-500/70'))
      .toBe(false)
  })
})
