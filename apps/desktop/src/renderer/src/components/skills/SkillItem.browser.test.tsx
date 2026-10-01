import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import '@/renderer/src/styles/globals.css'
import { GSTACK_REPOSITORY_URL } from '@/shared/constants'
import type { FilesystemEntryIdentity, Skill } from '@/shared/types'
import {
  repositoryId,
  toAbsolutePath,
  toFileSizeBytes,
  toHttpUrl,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

const mockGetAll = vi.fn()

beforeEach(() => {
  // Install the `electron` IPC bridge the preload normally exposes. In browser
  // mode Vitest reuses the Chromium page across tests in a file; `vi.stubGlobal`
  // paired with `vi.unstubAllGlobals()` in afterEach keeps the fake scoped.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: vi.fn(() => (): void => {}),
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
  size: toFileSizeBytes(96),
  ctimeMs: 3,
  mtimeMs: 4,
}

/**
 * Build a minimal Skill fixture.
 * @param overrides - Partial Skill overrides
 * @returns Complete Skill object
 * @example makeSkill({ name: toSkillName('browse') })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: toSkillName('task'),
    description: 'Task management skill',
    path: toAbsolutePath('/home/user/.agents/skills/task'),
    filesystemIdentity: directoryIdentity,
    symlinkCount: toSymlinkCount(0),
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
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarkReducer,
      protect: protectReducer,
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

describe('SkillItem bulk-select checkbox', () => {
  test('keeps a bulk-select checkbox on the row with nothing selected, so no mode is needed to tick it', async () => {
    // Arrange
    const skill = makeSkill({ name: toSkillName('task') })

    // Act
    const { screen } = await renderSkillItem(skill)

    // Assert — the box is always in the DOM; hover or Tab reveals it at rest
    await expect.element(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  test('labels the unticked bulk checkbox "Select {name}" for screen readers', async () => {
    // Arrange
    const skill = makeSkill({ name: toSkillName('task') })

    // Act
    const { screen } = await renderSkillItem(skill)

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: /Select task/i }))
      .toBeInTheDocument()
  })

  test('flips the checkbox label to "Deselect {name}" once the skill is ticked', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(toggleSelection(toSkillName('task')))

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: /Deselect task/i }))
      .toBeInTheDocument()
  })

  test('keeps the checkbox after the last tick is cleared, so the card content never shifts back', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { clearSelection, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(toSkillName('task')))
    await expect
      .element(screen.getByRole('checkbox', { name: 'Deselect task' }))
      .toBeInTheDocument()

    // Act
    store.dispatch(clearSelection())

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: 'Select task' }))
      .toBeInTheDocument()
  })

  test('disables the row checkbox while a bulk operation runs', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: 'Select task' }))
      .toBeDisabled()
  })
})

describe('SkillItem symlink status badges', () => {
  test('shows inaccessible slots instead of treating them as unlinked', async () => {
    // Arrange
    const inaccessibleSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'inaccessible',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
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

  test('hides the normal unlink button for inaccessible slots in agent view', async () => {
    // Arrange
    const inaccessibleSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'inaccessible',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
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
        screen.getByLabelText('Inaccessible link — manual review required'),
      )
      .toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Unlink task from/i }).query(),
    ).toBeNull()
  })

  test('hides the normal unlink button for broken slots in agent view', async () => {
    // Arrange
    const brokenSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
        {
          agentId: 'codex',
          agentName: 'Codex',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.codex/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
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
      .poll(() =>
        screen.getByRole('button', { name: 'Add task to an agent' }).query(),
      )
      .toBeNull()
  })

  test('hides Add for inaccessible slots so copy routing cannot fan out', async () => {
    // Arrange
    const inaccessibleSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'inaccessible',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
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
        screen.getByLabelText('Inaccessible link — manual review required'),
      )
      .toBeInTheDocument()
    await expect
      .poll(() =>
        screen.getByRole('button', { name: 'Add task to an agent' }).query(),
      )
      .toBeNull()
  })

  test('renders a disabled checkbox for broken agent rows that cannot use generic unlink', async () => {
    // Arrange
    const brokenSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
      isOrphan: true,
    })
    const { screen, store } = await renderSkillItem(brokenSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))

    // Assert — the slot stays rendered (so titles stay aligned) but the row is
    // marked out-of-scope via a disabled checkbox and an "is not eligible"
    // label carrying the reason, instead of vanishing. Keeping the checkbox
    // lets a row that was selected and then became ineligible still be
    // deselected individually.
    const ineligibleCheckbox = screen.getByRole('checkbox', {
      name: 'task is not eligible for bulk selection — Broken link — use Symlink cleanup to remove it',
    })
    await expect.element(ineligibleCheckbox).toBeInTheDocument()
    await expect.element(ineligibleCheckbox).toBeDisabled()
  })

  test('shows the ineligibility reason on hover so the disabled box does not read as a glitch', async () => {
    // Arrange — a local folder in Cursor view: bulk Unlink only removes
    // symlinks, so the row is out of scope.
    const localSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          isLocal: true,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(localSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(selectAgent('cursor'))
    const ineligibleCheckbox = screen.getByRole('checkbox', {
      name: 'task is not eligible for bulk selection — Local folder — bulk unlink only removes symlinks',
    })
    await expect.element(ineligibleCheckbox).toBeVisible()

    // Act — a disabled control takes no pointer events, so the tooltip lives
    // on the wrapping label; hover the label's hit area.
    const label = ineligibleCheckbox.element().closest('label')
    if (!label) throw new Error('expected the checkbox label hit area')
    await userEvent.hover(label)

    // Assert
    await expect
      .element(
        screen.getByRole('tooltip', {
          name: 'Local folder — bulk unlink only removes symlinks',
        }),
      )
      .toBeVisible()
  })

  test('names protection as the reason on a protected valid-linked row so the lock is explained end to end', async () => {
    // Arrange — valid Cursor link, then protected via protectSlice. The
    // protected flag comes from a different slice than the symlink visibility
    // flags, so this wires the full path (getBulkIneligibilityReason input
    // could silently drop it and fall through to the 'valid' → null branch).
    const validSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(validSkill)
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    store.dispatch(fetchSkills.fulfilled([validSkill], 'skills-req'))
    store.dispatch(selectAgent('cursor'))

    // Act
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert — the box is disabled and names the lock, both in its accessible
    // name and in the hover tooltip on the label hit area.
    const ineligibleCheckbox = screen.getByRole('checkbox', {
      name: 'task is not eligible for bulk selection — Protected — unlock to include in bulk actions',
    })
    await expect.element(ineligibleCheckbox).toBeVisible()
    await expect.element(ineligibleCheckbox).toBeDisabled()
    const label = ineligibleCheckbox.element().closest('label')
    if (!label) throw new Error('expected the checkbox label hit area')
    await userEvent.hover(label)
    await expect
      .element(
        screen.getByRole('tooltip', {
          name: 'Protected — unlock to include in bulk actions',
        }),
      )
      .toBeVisible()
  })

  test('keeps an eligible row checkbox free of any reason tooltip', async () => {
    // Arrange — a valid symlinked row in Cursor view.
    const validSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(validSkill)
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    // Eligibility reads the loaded list, not the rendered prop — without the
    // row in `skills.items` every agent-view checkbox reads as ineligible.
    store.dispatch(fetchSkills.fulfilled([validSkill], 'skills-req'))
    store.dispatch(selectAgent('cursor'))
    const checkbox = screen.getByRole('checkbox', { name: 'Select task' })
    await expect.element(checkbox).toBeVisible()

    // Act
    const label = checkbox.element().closest('label')
    if (!label) throw new Error('expected the checkbox label hit area')
    await userEvent.hover(label)

    // Assert — no tooltip opens; the accessible name stays plain.
    await expect.poll(() => screen.getByRole('tooltip').query()).toBeNull()
  })

  test('keeps the plain "not eligible" label and no tooltip on a still-mounted valid row behind the skills error screen', async () => {
    // Arrange — a valid symlinked row in Cursor view that becomes ineligible
    // when a rejected refresh sets skills.error: the error screen empties the
    // eligible list while this row is still mounted. There is no named cause,
    // so the box must fall back to the bare "not eligible" name instead of
    // announcing `— undefined` or hanging a reasonless tooltip on the label.
    const validSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(validSkill)
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([validSkill], 'skills-req'))
    store.dispatch(selectAgent('cursor'))
    await expect
      .element(screen.getByRole('checkbox', { name: 'Select task' }))
      .toBeEnabled()

    // Act
    store.dispatch(
      fetchSkills.rejected(new Error('disk read failed'), 'refresh'),
    )

    // Assert — disabled with the bare label, and hovering the hit-area label
    // opens no tooltip because the reason is null.
    const checkbox = screen.getByRole('checkbox', {
      name: 'task is not eligible for bulk selection',
    })
    await expect.element(checkbox).toBeDisabled()
    const label = checkbox.element().closest('label')
    if (!label) throw new Error('expected the checkbox label hit area')
    await userEvent.hover(label)
    await expect.poll(() => screen.getByRole('tooltip').query()).toBeNull()
  })

  test('keeps a ticked ineligible row deselectable through the reason tooltip wrapper', async () => {
    // Arrange — a row that stays ticked after its Cursor link turns out
    // broken (the "+N not eligible" header population): the box must stay an
    // enabled Deselect control so the user can back the tick out, and the new
    // TooltipTrigger wrapper around the label must not swallow the click.
    const brokenSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
      isOrphan: false,
    })
    const { screen, store } = await renderSkillItem(brokenSkill)
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([brokenSkill], 'skills-req'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(toggleSelection(toSkillName('task')))
    // Ticked + ineligible keeps the Deselect verb but still names the reason —
    // the "+N not eligible" header count is exactly this population.
    const checkbox = screen.getByRole('checkbox', {
      name: 'Deselect task — Broken link — use Symlink cleanup to remove it',
    })
    await expect.element(checkbox).toBeEnabled()

    // Act — untick through the tooltip-wrapped hit area.
    await checkbox.click()

    // Assert — the tick cleared and the box dropped back to the disabled,
    // reason-carrying ineligible label.
    await expect
      .element(
        screen.getByRole('checkbox', {
          name: 'task is not eligible for bulk selection — Broken link — use Symlink cleanup to remove it',
        }),
      )
      .toBeDisabled()
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })
})

describe('SkillItem delete button', () => {
  // Every skill — including ones tracked in `~/.agents/.skill-lock.json` via a
  // `source` field — opens the same trash + UndoToast dialog. The CLI removal
  // fork was retired (npx skills spawn was unreliable for ~/.agents/skills);
  // stale lock-file entries are the accepted trade-off.

  test('offers a "Delete {name}" button for a source-tracked skill', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({
        name: toSkillName('brainstorming'),
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

  test('offers a "Delete {name}" button for a plain skill', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({ name: toSkillName('local-skill') }),
    )

    // Act
    // (no interaction — assert the delete affordance is present)

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /^Delete local-skill$/i }))
      .toBeInTheDocument()
  })

  test('opens the trash confirm dialog when deleting a source-tracked skill', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('brainstorming'),
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
      // A card's own Delete leaves the other ticked rows alone when it settles.
      origin: 'row',
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
      protectedErrors: [],
    })
  })

  test('opens the trash confirm dialog when deleting a plain skill', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('local-skill') }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete local-skill$/i }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toEqual({
      kind: 'delete',
      origin: 'row',
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
      protectedErrors: [],
    })
  })

  test('does not open the inspector pane when the delete button is clicked', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('brainstorming') }),
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

describe('SkillItem card X buttons while a bulk operation runs', () => {
  test('ignores the card Delete button while a bulk operation is running', async () => {
    // Arrange — a header bulk op holds the shared busy flag
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('brainstorming') }),
    )
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )
    await expect
      .element(screen.getByRole('checkbox', { name: 'Select brainstorming' }))
      .toBeDisabled()

    // Act
    await screen
      .getByRole('button', { name: /^Delete brainstorming$/i })
      .click()

    // Assert — no second confirmation opens behind the running op, and the
    // click still stays off the card
    expect(store.getState().ui.bulkConfirm).toBeNull()
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('ignores the agent-view Unlink button while a bulk operation is running', async () => {
    // Arrange — agent view, and a header bulk op holds the shared busy flag
    const linkedSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(linkedSkill)
    const { bulkCopyToAgents, fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([linkedSkill], 'req-id'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )
    await expect
      .element(screen.getByRole('checkbox', { name: 'Select task' }))
      .toBeDisabled()

    // Act
    await screen
      .getByRole('button', { name: /^Unlink task from agent$/i })
      .click()

    // Assert — no unlink confirmation opens to race the running op on the
    // same link, and the click still stays off the card
    expect(store.getState().skills.skillToUnlink).toBeNull()
    expect(store.getState().skills.selectedSkill).toBeNull()
  })
})

describe('SkillItem Add button routing', () => {
  test('keeps Add out of the row heading so screen readers announce only the skill name', async () => {
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
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
      .toBeInTheDocument()
  })

  test('shows the Add button in agent view when the skill exists in the selected agent', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'valid',
            targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
            linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
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
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
      .toBeInTheDocument()
  })

  test('opens the copy-to-agent modal when Add is clicked in agent view', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'valid',
            targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
            linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
            isLocal: false,
          },
        ],
      }),
    )
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    await screen.getByRole('button', { name: 'Add task to an agent' }).click()

    // Assert
    expect(store.getState().skills.skillToCopy?.name).toBe('task')
    expect(store.getState().skills.skillToAddSymlinks).toBeNull()
  })

  test('opens the add-symlink modal when Add is clicked in global view', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(makeSkill())

    // Act
    await screen.getByRole('button', { name: 'Add task to an agent' }).click()

    // Assert
    expect(store.getState().skills.skillToAddSymlinks?.name).toBe('task')
    expect(store.getState().skills.skillToCopy).toBeNull()
  })
})

describe('SkillItem G-Stack badge', () => {
  test('shows a G-Stack badge link in supported agent view for gstack-managed skills', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            targetPath: toAbsolutePath('/Users/me/.claude/skills/gstack/task'),
            linkPath: toAbsolutePath('/Users/me/.claude/skills/task'),
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
        screen.getByRole('link', { name: /G-Stack — open GitHub repository/i }),
      )
      .toBeInTheDocument()
    await expect
      .element(gstackLink)
      .toHaveAttribute('href', GSTACK_REPOSITORY_URL)
  })

  test('hides the G-Stack badge in global view', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            targetPath: toAbsolutePath('/Users/me/.claude/skills/gstack/task'),
            linkPath: toAbsolutePath('/Users/me/.claude/skills/task'),
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

  test('shows badge for gstack-managed sibling skills (local skill whose SKILL.md symlinks into gstack)', async () => {
    // Arrange
    // Real production scenario: ~/.claude/skills/ship/ is a real directory
    // whose only entry is a SKILL.md symlink → ~/.claude/skills/gstack/ship/SKILL.md.
    // The skill's linkPath/targetPath alone do NOT contain "gstack" — only
    // the new skillMdSymlinkTarget field does. Without it, the badge is
    // hidden on every gstack sibling, which is the whole bug being fixed.
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('ship'),
        path: toAbsolutePath('/Users/me/.claude/skills/ship'),
        isSource: false,
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            linkPath: toAbsolutePath('/Users/me/.claude/skills/ship'),
            isLocal: true,
            skillMdSymlinkTarget: toAbsolutePath(
              '/Users/me/.claude/skills/gstack/ship/SKILL.md',
            ),
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

  test('hides the badge when skillMdSymlinkTarget points outside the gstack tree', async () => {
    // Arrange
    // Negative coverage at the wired-up SkillItem level: a local skill with
    // skillMdSymlinkTarget set but pointing at a user-managed path (no
    // `gstack` segment) must NOT receive the badge. The pure helper covers
    // this case in isolation, but a regression where someone fed
    // skillMdSymlinkTarget straight into the JSX (bypassing the helper)
    // would only surface here.
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('custom'),
        path: toAbsolutePath('/Users/me/.claude/skills/custom'),
        isSource: false,
        symlinks: [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            status: 'valid',
            linkPath: toAbsolutePath('/Users/me/.claude/skills/custom'),
            isLocal: true,
            skillMdSymlinkTarget: toAbsolutePath(
              '/Users/me/projects/my-skills/custom/SKILL.md',
            ),
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

  test('ticks the row for bulk select without opening the inspector pane', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )

    // Act
    await screen.getByRole('checkbox', { name: /Select task/i }).click()

    // Assert
    // Checkbox tick → selection updated in the skills slice, Inspector stays
    // closed. If stopPropagation regressed, selectedSkill would be set here.
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('extends the selection to the whole range on a shift-click with an existing anchor', async () => {
    // Arrange
    // Seed three visible rows so the range slice is meaningful, then plant an
    // anchor on 'alpha' (toggleSelection records the anchor). The rendered row
    // is the middle one ('task'); a shift-click on it should sweep alpha→task.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill({ name: toSkillName('alpha') }),
          makeSkill({ name: toSkillName('task') }),
          makeSkill({ name: toSkillName('zeta') }),
        ],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('alpha')))
    // Precondition: anchor planted, so the shift branch will actually run.
    expect(store.getState().skills.selectionAnchor).toBe('alpha')

    // Act — a real ⇧-click, so Radix's own toggle has to stay out of the way
    await screen
      .getByRole('checkbox', { name: /^Select task$/i })
      .click({ modifiers: ['Shift'] })

    // Assert
    // Range covers alpha (anchor) through task (clicked) inclusive — zeta is
    // outside the slice. alpha was already ticked, task is newly added (a
    // double toggle would have flipped task straight back off).
    await expect
      .poll(() => store.getState().skills.selectedSkillNames)
      .toEqual(['alpha', 'task'])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('ticks just the clicked row on a shift-click of its checkbox when nothing is anchored yet', async () => {
    // Arrange — three visible rows and an empty selection, so there is no
    // anchor to measure a range from.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill({ name: toSkillName('alpha') }),
          makeSkill({ name: toSkillName('task') }),
          makeSkill({ name: toSkillName('zeta') }),
        ],
        'req-id',
      ),
    )

    // Act — a real ⇧-click with no anchor falls through to the plain toggle
    await screen
      .getByRole('checkbox', { name: /^Select task$/i })
      .click({ modifiers: ['Shift'] })

    // Assert — only the clicked row, which becomes the next ⇧-click's anchor
    await expect
      .poll(() => store.getState().skills.selectedSkillNames)
      .toEqual(['task'])
    expect(store.getState().skills.selectionAnchor).toBe('task')
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('takes keyboard focus out of the search box on a shift-click of a row checkbox, so Esc and ⌘A reach the list', async () => {
    // Arrange — an anchor on 'alpha', and the user was typing in the search
    // box. The card's ⇧ text-selection guard cancels the press's focus move.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill({ name: toSkillName('alpha') }),
          makeSkill({ name: toSkillName('task') }),
          makeSkill({ name: toSkillName('zeta') }),
        ],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('alpha')))
    const searchInput = document.createElement('input')
    document.body.appendChild(searchInput)
    try {
      searchInput.focus()

      // Act
      await screen
        .getByRole('checkbox', { name: /^Select task$/i })
        .click({ modifiers: ['Shift'] })

      // Assert
      await expect
        .poll(() => store.getState().skills.selectedSkillNames)
        .toEqual(['alpha', 'task'])
      expect(document.activeElement).toBe(document.body)
    } finally {
      document.body.removeChild(searchInput)
    }
  })
})

describe('SkillItem unlink button', () => {
  test('stages the symlink for removal when unlinking a valid skill in agent view', async () => {
    // Arrange
    const validSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
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

  test('stages the local-folder slot for removal when deleting a local skill in agent view', async () => {
    // Arrange
    // A real local folder (isLocal: true) in the selected agent's skills dir
    // has no source symlink, so handleUnlinkClick must fall back to
    // selectedLocalSkillInfo. The X button reads "Delete ... from ...".
    const localSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
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
  test('bookmarks an unbookmarked skill with its repo and url', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        source: repositoryId('vercel-labs/agent-skills'),
        sourceUrl: toHttpUrl('https://github.com/vercel-labs/agent-skills.git'),
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

  test('removes the bookmark when toggling an already-bookmarked skill', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        source: repositoryId('vercel-labs/agent-skills'),
      }),
    )
    const { addBookmark } =
      await import('@/renderer/src/redux/slices/bookmarkSlice')
    store.dispatch(
      addBookmark({
        name: toSkillName('task'),
        repo: repositoryId('vercel-labs/agent-skills'),
        url: toHttpUrl('https://github.com/vercel-labs/agent-skills'),
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
  test('opens the inspector pane on the clicked skill when the card body is clicked', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
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

describe('SkillItem card modifier clicks', () => {
  test('⌘-click on the card ticks the row without opening the inspector', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Meta'] })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('⌘-click on a ticked card unticks it', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(toSkillName('task')))

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Meta'] })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  test('takes keyboard focus out of the search box on an agent-view ⌘-click, so Esc and ⌘A reach the list', async () => {
    // Arrange — agent view arms the "Copy to…" menu trigger, whose pointerdown
    // keeps focus where it was; the user was typing in the search box
    const linkedSkill = makeSkill({
      name: toSkillName('task'),
      description: 'Task management skill',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(linkedSkill)
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    // The agent view picks its eligible rows from the loaded list.
    store.dispatch(fetchSkills.fulfilled([linkedSkill], 'req-id'))
    store.dispatch(selectAgent('cursor'))
    await expect
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
      .toBeInTheDocument()
    const searchInput = document.createElement('input')
    document.body.appendChild(searchInput)
    try {
      searchInput.focus()

      // Act
      await screen
        .getByText('Task management skill')
        .click({ modifiers: ['Meta'] })

      // Assert
      expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
      expect(document.activeElement).toBe(document.body)
    } finally {
      document.body.removeChild(searchInput)
    }
  })

  test('takes keyboard focus out of the search box on an agent-view plain click, so Esc still clears the ticked rows', async () => {
    // Arrange — agent view, 'task' ticked, and the user was typing in the
    // search box when they clicked the card to inspect it
    const linkedSkill = makeSkill({
      name: toSkillName('task'),
      description: 'Task management skill',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(linkedSkill)
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([linkedSkill], 'req-id'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(toggleSelection(toSkillName('task')))
    await expect
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
      .toBeInTheDocument()
    const searchInput = document.createElement('input')
    document.body.appendChild(searchInput)
    try {
      searchInput.focus()

      // Act
      await screen.getByText('Task management skill').click()

      // Assert — the click inspects the row and leaves the keyboard with the list
      expect(store.getState().skills.selectedSkill?.name).toBe('task')
      expect(document.activeElement).toBe(document.body)
    } finally {
      document.body.removeChild(searchInput)
    }
  })

  test('moves the text caret out of the Inspector on an agent-view ⌘-click, so ⌘A ticks rows instead of selecting the file text', async () => {
    // Arrange — agent view, and the caret was left in the Inspector's file
    // text; the "Copy to…" menu trigger keeps a card press from moving it
    const linkedSkill = makeSkill({
      name: toSkillName('task'),
      description: 'Task management skill',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(linkedSkill)
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([linkedSkill], 'req-id'))
    store.dispatch(selectAgent('cursor'))
    await expect
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
      .toBeInTheDocument()
    const inspectorPane = document.createElement('aside')
    inspectorPane.setAttribute('data-inspector-pane', '')
    const fileText = document.createTextNode('# SKILL.md body')
    inspectorPane.append(fileText)
    document.body.appendChild(inspectorPane)
    try {
      document.getSelection()?.collapse(fileText, 2)

      // Act
      await screen
        .getByText('Task management skill')
        .click({ modifiers: ['Meta'] })

      // Assert
      expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
      expect(document.getSelection()?.anchorNode ?? null).toBeNull()
    } finally {
      document.body.removeChild(inspectorPane)
    }
  })

  test('⇧-click on the card selects the range from the anchor without opening the inspector', async () => {
    // Arrange — three visible rows, anchor on 'alpha', rendered row 'task'
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill({ name: toSkillName('alpha') }),
          makeSkill({ name: toSkillName('beta') }),
          makeSkill({ name: toSkillName('task') }),
        ],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('alpha')))

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Shift'] })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha',
      'beta',
      'task',
    ])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('⇧-click with no anchor ticks just the clicked card, like a ⌘-click', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Shift'] })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
  })

  test('⇧-click on an ineligible row selects only the eligible rows up to it', async () => {
    // Arrange — Cursor view: alpha and beta are linked, the rendered 'task'
    // has a broken link, so it cannot be unlinked in bulk.
    const linkedTo = (name: string): Skill['symlinks'] => [
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status: 'valid',
        linkPath: toAbsolutePath(`/home/user/.cursor/skills/${name}`),
        targetPath: toAbsolutePath(`/home/user/.agents/skills/${name}`),
        isLocal: false,
      },
    ]
    const brokenTask = makeSkill({
      name: toSkillName('task'),
      description: 'Task management skill',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(brokenTask)
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill({
            name: toSkillName('alpha'),
            symlinks: linkedTo('alpha'),
          }),
          makeSkill({ name: toSkillName('beta'), symlinks: linkedTo('beta') }),
          brokenTask,
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(toggleSelection(toSkillName('alpha')))

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Shift'] })

    // Assert — the span stops short of the broken row itself
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha',
      'beta',
    ])
  })

  test('⌘-click on an ineligible, unticked row changes nothing', async () => {
    // Arrange — Cursor view, the rendered row's link is broken
    const brokenTask = makeSkill({
      name: toSkillName('task'),
      description: 'Task management skill',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(brokenTask)
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([brokenTask], 'req-id'))
    store.dispatch(selectAgent('cursor'))

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Meta'] })

    // Assert — not ticked, and the inspector stays closed as well
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('⌘-click on a ticked row that is no longer eligible unticks it', async () => {
    // Arrange — Cursor view: 'task' is still ticked, but a rescan found its
    // link broken. It cannot be picked up again, yet it must be let go.
    const brokenTask = makeSkill({
      name: toSkillName('task'),
      description: 'Task management skill',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(brokenTask)
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([brokenTask], 'req-id'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(toggleSelection(toSkillName('task')))
    await expect
      .element(
        screen.getByRole('checkbox', {
          name: 'Deselect task — Broken link — use Symlink cleanup to remove it',
        }),
      )
      .toBeEnabled()

    // Act
    await screen
      .getByText('Task management skill')
      .click({ modifiers: ['Meta'] })

    // Assert — unticked, and the inspector stays closed as well
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('stops a ⇧-click on the card from dragging a text selection across cards', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )
    const cardText = screen.getByText('Task management skill').element()
    const shiftMouseDown = new MouseEvent('mousedown', {
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    const plainMouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    })

    // Act
    cardText.dispatchEvent(shiftMouseDown)
    cardText.dispatchEvent(plainMouseDown)

    // Assert — only the ⇧ press cancels the browser's text-selection default,
    // so a plain press can still select text in the card.
    expect(shiftMouseDown.defaultPrevented).toBe(true)
    expect(plainMouseDown.defaultPrevented).toBe(false)
  })

  test('ignores ⌘-click and ⇧-click on the card while a bulk operation runs', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )
    const cardText = screen.getByText('Task management skill')

    // Act
    await cardText.click({ modifiers: ['Meta'] })
    await cardText.click({ modifiers: ['Shift'] })

    // Assert — neither click reaches the selection or the inspector
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().skills.selectedSkill).toBeNull()
  })

  test('still opens the inspector on a plain click while a bulk operation runs', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({
        name: toSkillName('task'),
        description: 'Task management skill',
      }),
    )
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )

    // Act
    await screen.getByText('Task management skill').click()

    // Assert
    expect(store.getState().skills.selectedSkill?.name).toBe('task')
  })
})

describe('SkillItem G-Stack badge click', () => {
  test('keeps the inspector closed when the G-Stack badge is clicked', async () => {
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
          name: toSkillName('task'),
          symlinks: [
            {
              agentId: 'claude-code',
              agentName: 'Claude Code',
              status: 'valid',
              targetPath: toAbsolutePath(
                '/Users/me/.claude/skills/gstack/task',
              ),
              linkPath: toAbsolutePath('/Users/me/.claude/skills/task'),
              isLocal: false,
            },
          ],
        }),
      )
      const { selectAgent } =
        await import('@/renderer/src/redux/slices/uiSlice')
      store.dispatch(selectAgent('claude-code'))

      // Act
      // The anchor's aria-label ("G-Stack — open GitHub repository") is its
      // accessible name; match a substring of it.
      await screen
        .getByRole('link', { name: /G-Stack — open GitHub repository/i })
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
  test('stages the skill for copy when "Copy to…" is chosen from the right-click menu', async () => {
    // Arrange
    // Copy is only offered in agent view for a usable (valid, non-local) skill.
    const validSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
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
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
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

  test('does not open the right-click menu for a skill that cannot be copied', async () => {
    // Arrange
    // Global view: showCopyButton is false, so onContextMenu returns early and
    // no menu item is ever rendered.
    const { screen } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
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
  test('flashes a red left edge for the matching row then clears it after the timeout', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { flashFailedRows } =
      await import('@/renderer/src/utils/bulkOpVisuals')
    const card = screen.getByText('Task management skill').element()
    // Walk up to the Card root that carries the data-skill-name + edge classes.
    const cardRoot = card.closest('[data-skill-name="task"]')
    expect(cardRoot).not.toBeNull()

    // Act
    // Fire the per-row failure event MainContent uses after a partial bulk op.
    flashFailedRows([toSkillName('task')])

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

  test('ignores a failure event addressed to a different row', async () => {
    // Arrange
    const { screen } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { flashFailedRows } =
      await import('@/renderer/src/utils/bulkOpVisuals')
    const card = screen.getByText('Task management skill').element()
    const cardRoot = card.closest('[data-skill-name="task"]')

    // Act
    // A different skill's failure must not paint this row red (early return on
    // the skillName guard).
    flashFailedRows([toSkillName('other-skill')])

    // Assert
    await expect
      .poll(() => cardRoot?.className.includes('border-l-red-500/70'))
      .toBe(false)
  })
})

describe('SkillItem protection', () => {
  test('shows a "Lock {name}" button when the skill is not protected', async () => {
    // Arrange — default store has protect.items=[], so the skill is unlocked.
    const { screen } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )

    // Act
    // (no interaction — assert the lock affordance label matches the unlocked state)

    // Assert — LockOpen icon with "Lock task" label indicates protection is off.
    await expect
      .element(screen.getByRole('button', { name: /^Lock task$/i }))
      .toBeInTheDocument()
  })

  test('records the skill directory behind the lock so a later rename keeps it locked', async () => {
    // Arrange — the row carries the identity `scanSourceSkills` captured.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )

    // Act
    await screen.getByRole('button', { name: /^Lock task$/i }).click()

    // Assert — locking by name alone is what stranded the lock on rename;
    // the inode is captured now, not left to the next scan.
    expect(store.getState().protect.items).toEqual([
      { name: 'task', identity: { dev: 1, ino: 2 } },
    ])
  })

  test('locks a row the scan captured no identity for without inventing one', async () => {
    // Arrange — agent-linked symlinks and orphans reach the list with no
    // `filesystemIdentity`; only `scanSourceSkills` records one.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task'), filesystemIdentity: undefined }),
    )

    // Act
    await screen.getByRole('button', { name: /^Lock task$/i }).click()

    // Assert — a name-only lock, exactly as before v5. Writing a placeholder
    // inode here would bind the lock to a directory that was never scanned.
    expect(store.getState().protect.items).toEqual([{ name: 'task' }])
  })

  test('labels a protected skill and offers an Unlock action', async () => {
    // Arrange — dispatch addProtection before rendering so ProtectButton
    // receives isProtected=true and renders the Lock icon.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')

    // Act
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert — text makes protection scannable while the lock remains actionable.
    await expect
      .element(screen.getByRole('button', { name: /^Unlock task$/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Protected', { exact: true }))
      .toBeVisible()
  })

  test('explains that delete is unavailable while the skill is protected', async () => {
    // Arrange
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')

    // Act — protect the skill so the destructive action becomes unavailable.
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert — keep the stable action slot visible, expose its ARIA state, and name why.
    const deleteButton = screen.getByRole('button', {
      name: /^Delete task unavailable while protected$/i,
    })
    await expect.element(deleteButton).toBeVisible()
    await expect.element(deleteButton).toHaveAttribute('aria-disabled', 'true')
  })

  test('removes the Protected label and enables delete after unlocking', async () => {
    // Arrange — start locked, then unlock.
    const { screen, store } = await renderSkillItem(
      makeSkill({ name: toSkillName('task') }),
    )
    const { addProtection, removeProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Act
    store.dispatch(removeProtection(toSkillName('task')))

    // Assert — the visible status clears and the same destructive slot is usable.
    const deleteButton = screen.getByRole('button', { name: /^Delete task$/i })
    await expect.element(deleteButton).toBeInTheDocument()
    await expect.element(deleteButton).not.toBeDisabled()
    await expect
      .element(screen.getByText('Protected', { exact: true }))
      .not.toBeInTheDocument()
  })

  test('hides the agent-view unlink button when the skill is locked', async () => {
    // Arrange
    const linkedSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(linkedSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /^Unlock task$/i }))
      .toBeInTheDocument()
    await expect
      .poll(() =>
        screen
          .getByRole('button', { name: /^Unlink task from agent$/i })
          .query(),
      )
      .toBeNull()
  })

  test('hides the agent-view local delete button when the skill is locked', async () => {
    // Arrange
    const localSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          isLocal: true,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(localSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')

    // Act
    store.dispatch(selectAgent('cursor'))
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /^Unlock task$/i }))
      .toBeInTheDocument()
    await expect
      .poll(() =>
        screen
          .getByRole('button', { name: /^Delete task from agent$/i })
          .query(),
      )
      .toBeNull()
  })

  test('restores the agent-view unlink button when the skill is unlocked', async () => {
    // Arrange
    const linkedSkill = makeSkill({
      name: toSkillName('task'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillItem(linkedSkill)
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { addProtection, removeProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    store.dispatch(selectAgent('cursor'))
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Act
    store.dispatch(removeProtection(toSkillName('task')))

    // Assert
    await expect
      .element(
        screen.getByRole('button', { name: /^Unlink task from agent$/i }),
      )
      .toBeInTheDocument()
  })
})

describe('SkillItem unreadable badge', () => {
  test('marks a source skill whose SKILL.md could not be read instead of hiding the row', async () => {
    // Arrange: the scan kept the row and flagged it, rather than dropping it.
    const unreadableSkill = makeSkill({ isUnreadable: true })

    // Act
    const { screen } = await renderSkillItem(unreadableSkill)

    // Assert: the row is present AND says why it could not be confirmed, so a
    // permissions problem never reads as the skill having been deleted.
    await expect
      .element(screen.getByTestId('skill-unreadable-badge-task'))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByLabelText('Unreadable skill — SKILL.md could not be read'),
      )
      .toBeInTheDocument()
  })

  test('leaves a skill with a readable SKILL.md unbadged', async () => {
    // Arrange
    const readableSkill = makeSkill()

    // Act
    const { screen } = await renderSkillItem(readableSkill)

    // Assert: the amber warning must not appear on every healthy row.
    expect(screen.getByTestId('skill-unreadable-badge-task').query()).toBeNull()
  })
})

/** Card width at the 264px panel floor: 264 − 32 padding/gutter = 232. */
const FLOOR_CARD_WIDTH_PX = 232
/** Outer card width whose content box is 318px < 20rem once the 1px border
 * is subtracted — the tightest wrapper that must already collapse. */
const ICON_TIER_BOUNDARY_WIDTH_PX = 320
/** Card width comfortably above the icon tier for the wide-tier spec. */
const WIDE_CARD_WIDTH_PX = 480

describe('SkillItem icon tier (card under 20rem)', () => {
  test('collapses word badges and action labels to icons so the title row never clips at the 232px floor card', async () => {
    // Arrange — protected + unreadable + the always-on Add button is the
    // busiest realistic title row; 232px is the card width at the 264px
    // panel floor ({@link PANEL_MIN_WIDTH_PX} in App.tsx).
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const busySkill = makeSkill({ isUnreadable: true })
    const store = await createStore()
    const { SkillItem } = await import('./SkillItem')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ width: FLOOR_CARD_WIDTH_PX }}>
            <SkillItem skill={busySkill} />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(addProtection({ name: toSkillName('task') }))
    const card = screen.getByTestId('skill-protected-badge-task')
    await expect.element(card).toBeInTheDocument()

    // Assert — accessible names survive the collapse (role="img" pills and
    // the labelled Add button).
    await expect
      .element(
        screen.getByLabelText(
          'Protected — bulk delete and unlink skip this skill',
        ),
      )
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByLabelText('Unreadable skill — SKILL.md could not be read'),
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Add task to an agent' }))
      .toBeInTheDocument()
    // The collapsed pills are icon-sized, not word-sized. Poll because the
    // global stylesheet lands a tick after mount in the browser lane.
    await expect
      .poll(
        () =>
          screen
            .getByTestId('skill-protected-badge-task')
            .element()
            .getBoundingClientRect().width,
      )
      .toBeLessThan(30)
    await expect
      .poll(
        () =>
          screen
            .getByTestId('skill-unreadable-badge-task')
            .element()
            .getBoundingClientRect().width,
      )
      .toBeLessThan(30)
    // Nothing in the card escapes its box horizontally.
    const cardElement = screen
      .getByTestId('skill-protected-badge-task')
      .element()
      .closest('[data-skill-name]')
    if (!cardElement) throw new Error('SkillItem card not found')
    const cardRect = cardElement.getBoundingClientRect()
    for (const el of cardElement.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect()
      // Both edges — a collapse that clips left is as broken as one that
      // overflows right.
      expect(rect.right).toBeLessThanOrEqual(cardRect.right + 0.5)
      expect(rect.left).toBeGreaterThanOrEqual(cardRect.left - 0.5)
    }
  })

  test('collapses at a 320px card because the 20rem query measures the content box inside the border', async () => {
    // Arrange — `@max-[20rem]` compiles to `width < 20rem` on the container's
    // CONTENT box, so a 320px card (318px inside its 1px border) must already
    // be icon-only. Pins the boundary so a future breakpoint change or a
    // border/padding tweak can't silently shift the tier.
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const store = await createStore()
    const { SkillItem } = await import('./SkillItem')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ width: ICON_TIER_BOUNDARY_WIDTH_PX }}>
            <SkillItem skill={makeSkill({ isUnreadable: true })} />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(addProtection({ name: toSkillName('task') }))
    const badge = screen.getByTestId('skill-protected-badge-task')
    await expect.element(badge).toBeInTheDocument()

    // Assert — poll because the global stylesheet lands a tick after mount.
    await expect
      .poll(() => badge.element().getBoundingClientRect().width)
      .toBeLessThan(30)
  })

  test('keeps the badge words and action labels rendered at the wide tier so the collapse stays bounded below 20rem', async () => {
    // Arrange — the same busiest row as the icon-tier spec, but in a 480px
    // card (above the 320px breakpoint). If `@max-[20rem]:sr-only` ever
    // leaked into the wide tier — unconditional class, flipped breakpoint —
    // the aria-label assertions above would still pass because sr-only text
    // stays in the DOM; only a width check catches the words going missing.
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const busySkill = makeSkill({ isUnreadable: true })
    const store = await createStore()
    const { SkillItem } = await import('./SkillItem')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ width: WIDE_CARD_WIDTH_PX }}>
            <SkillItem skill={busySkill} />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(addProtection({ name: toSkillName('task') }))
    await expect
      .element(screen.getByTestId('skill-protected-badge-task'))
      .toBeInTheDocument()

    // Assert — each pill keeps its word, so it lands well past the <30px
    // icon-only box the icon tier shrinks to. Poll because the global
    // stylesheet lands a tick after mount in the browser lane.
    const protectedBadge = screen
      .getByTestId('skill-protected-badge-task')
      .element()
    await expect
      .poll(() => protectedBadge.getBoundingClientRect().width)
      .toBeGreaterThan(30)
    await expect
      .poll(
        () =>
          screen
            .getByTestId('skill-unreadable-badge-task')
            .element()
            .getBoundingClientRect().width,
      )
      .toBeGreaterThan(30)
    // A rendered word span takes real inline space; sr-only would box it at 1px.
    const wordSpan = protectedBadge.querySelector('span')
    if (!wordSpan) throw new Error('Protected word span not found')
    expect(wordSpan.getBoundingClientRect().width).toBeGreaterThan(10)
    // The new role="img" + title carry the pill's name once collapsed, and
    // must exist in the wide tier too (the collapse is a pure visual change).
    await expect
      .element(
        screen.getByRole('img', {
          name: 'Protected — bulk delete and unlink skip this skill',
        }),
      )
      .toBeInTheDocument()
    // Add keeps its word and hover title in the wide tier.
    const addButton = screen.getByRole('button', {
      name: 'Add task to an agent',
    })
    await expect.element(addButton).toBeInTheDocument()
    await expect
      .element(addButton)
      .toHaveAttribute('title', 'Add task to an agent')
    const addWord = addButton.element().querySelector('span')
    if (!addWord) throw new Error('Add word span not found')
    expect(addWord.getBoundingClientRect().width).toBeGreaterThan(10)
  })

  test('collapses the G-Stack link to an icon-only anchor in the icon tier while keeping its repository name', async () => {
    // Arrange — a gstack-managed slot for a badge-eligible agent is the only
    // row the link renders on; 232px is the floor-width card.
    const gstackSkill = makeSkill({
      symlinks: [
        {
          agentId: 'claude-code',
          agentName: 'Claude Code',
          status: 'valid',
          targetPath: toAbsolutePath('/Users/me/.claude/skills/gstack/task'),
          linkPath: toAbsolutePath('/Users/me/.claude/skills/task'),
          isLocal: false,
        },
      ],
    })
    const store = await createStore()
    const { SkillItem } = await import('./SkillItem')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ width: FLOOR_CARD_WIDTH_PX }}>
            <SkillItem skill={gstackSkill} />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(selectAgent('claude-code'))

    // Assert — the anchor keeps its accessible name + hover title while the
    // "G-Stack" word collapses to sr-only, leaving an icon-width pill.
    const gstackLink = screen.getByRole('link', {
      name: 'G-Stack — open GitHub repository',
    })
    await expect.element(gstackLink).toBeInTheDocument()
    await expect
      .element(gstackLink)
      .toHaveAttribute('title', 'G-Stack — open GitHub repository')
    const linkElement = gstackLink.element()
    await expect
      .poll(() => linkElement.getBoundingClientRect().width)
      .toBeLessThan(30)
    const gstackWord = linkElement.querySelector('span')
    if (!gstackWord) throw new Error('G-Stack word span not found')
    expect(gstackWord.getBoundingClientRect().width).toBeLessThan(5)
    // The same card's Add button collapses too — icon footprint, kept label.
    const addWord = screen
      .getByRole('button', { name: 'Add task to an agent' })
      .element()
      .querySelector('span')
    if (!addWord) throw new Error('Add word span not found')
    expect(addWord.getBoundingClientRect().width).toBeLessThan(5)
  })

  test('collapses the orphan and inaccessible amber pills to icons in the icon tier', async () => {
    // Arrange — the three amber pills share AMBER_STATUS_BADGE_CLASS but are
    // separate JSX blocks; the first spec covered unreadable, so this one
    // exercises the other two. Orphan renders in any view; inaccessible
    // needs a selected agent whose slot carries `inaccessible` status.
    const orphanSkill = makeSkill({
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
      isOrphan: true,
    })
    const inaccessibleSkill = makeSkill({
      name: toSkillName('review'),
      path: toAbsolutePath('/home/user/.agents/skills/review'),
      symlinks: [
        {
          agentId: 'claude-code',
          agentName: 'Claude Code',
          status: 'inaccessible',
          linkPath: toAbsolutePath('/Users/me/.claude/skills/review'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/review'),
          isLocal: false,
        },
      ],
    })
    const store = await createStore()
    const { SkillItem } = await import('./SkillItem')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ width: FLOOR_CARD_WIDTH_PX }}>
            <SkillItem skill={orphanSkill} />
            <SkillItem skill={inaccessibleSkill} />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(selectAgent('claude-code'))

    // Assert — accessible names survive the collapse; both pills shrink to
    // icon size (<30px, same bound as the first icon-tier spec).
    const orphanBadge = screen.getByTestId('skill-orphan-badge-task')
    await expect.element(orphanBadge).toBeInTheDocument()
    const inaccessibleBadge = screen.getByLabelText(
      'Inaccessible link — manual review required',
    )
    await expect.element(inaccessibleBadge).toBeInTheDocument()
    await expect
      .poll(() => orphanBadge.element().getBoundingClientRect().width)
      .toBeLessThan(30)
    await expect
      .poll(() => inaccessibleBadge.element().getBoundingClientRect().width)
      .toBeLessThan(30)
  })

  test('keeps the card height identical between the icon and wide tiers so virtualized row slots stay aligned', async () => {
    // Arrange — the same busy row at 232px (icon tier) and 480px (wide). The
    // collapse is horizontal-only on purpose: SkillsList's getRowHeight
    // reserves one slot height, so a card that grew a line while collapsing
    // would misalign every virtualized row below it.
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const narrowSkill = makeSkill({ isUnreadable: true })
    const wideSkill = makeSkill({
      name: toSkillName('task-wide'),
      path: toAbsolutePath('/home/user/.agents/skills/task-wide'),
      isUnreadable: true,
    })
    const store = await createStore()
    const { SkillItem } = await import('./SkillItem')
    await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ width: FLOOR_CARD_WIDTH_PX }}>
              <SkillItem skill={narrowSkill} />
            </div>
            <div style={{ width: WIDE_CARD_WIDTH_PX }}>
              <SkillItem skill={wideSkill} />
            </div>
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(addProtection({ name: toSkillName('task') }))
    store.dispatch(addProtection({ name: toSkillName('task-wide') }))

    // Assert — same content in both tiers: identical height. The diff is
    // measured inside ONE poll so a late-loading stylesheet or badge can't
    // freeze a stale wide-card height into the expectation.
    const narrowCard = document.querySelector('[data-skill-name="task"]')
    const wideCard = document.querySelector('[data-skill-name="task-wide"]')
    if (!narrowCard || !wideCard) throw new Error('SkillItem card not found')
    await expect
      .poll(
        () =>
          narrowCard.getBoundingClientRect().height -
          wideCard.getBoundingClientRect().height,
      )
      .toBe(0)
  })
})
