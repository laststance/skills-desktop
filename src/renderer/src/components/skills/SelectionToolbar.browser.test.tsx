import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { AgentId } from '@/shared/constants'
import type { Skill, SkillName, SymlinkInfo } from '@/shared/types'
import {
  toAbsolutePath,
  toBatchItemCount,
  toBatchItemIndex,
  toSearchQuery,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

/**
 * Build a source skill fixture with one agent symlink slot for toolbar tests.
 * @param name - Skill name shown in Redux and bulk payloads.
 * @param status - Cursor symlink status; drives bulk eligibility per row.
 * @returns Skill fixture the real skills reducer can load via fetchSkills.fulfilled.
 * @example makeCursorSkill('alpha', 'valid').symlinks[0]?.status // => 'valid'
 */
function makeCursorSkill(
  name: SkillName,
  status: SymlinkInfo['status'],
): Skill {
  return {
    name,
    description: '',
    path: toAbsolutePath(`/Users/test/.agents/skills/${name}`),
    symlinkCount: toSymlinkCount(status === 'missing' ? 0 : 1),
    symlinks: [
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status,
        linkPath: toAbsolutePath(`/Users/test/.cursor/skills/${name}`),
        targetPath: toAbsolutePath(`/Users/test/.agents/skills/${name}`),
        isLocal: false,
      },
    ],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Render SelectionToolbar directly against real skills + ui reducers.
 * @param options.skills - Skill rows loaded into the Installed list.
 * @param options.selectedNames - Names ticked before mount (drives visibility).
 * @param options.agentId - Active agent filter; null = global delete view.
 * @param options.onCopyAction - Optional copy callback; omit to hide Copy button.
 * @param options.agentDisplayName - Display name for the agent-view Unlink label.
 * @returns Browser screen, Redux store, and the primary-action spy.
 */
async function renderToolbar(options: {
  skills: Skill[]
  selectedNames: SkillName[]
  agentId: AgentId | null
  onCopyAction?: () => void
  agentDisplayName?: string
}) {
  const { skills, selectedNames, agentId, onCopyAction, agentDisplayName } =
    options
  const {
    default: skillsReducer,
    fetchSkills,
    selectAll,
  } = await import('@/renderer/src/redux/slices/skillsSlice')
  const {
    default: uiReducer,
    enterBulkSelectMode,
    selectAgent,
    setSearchQuery,
  } = await import('@/renderer/src/redux/slices/uiSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  const { SelectionToolbar } = await import('./SelectionToolbar')

  const store = configureStore({
    reducer: {
      skills: skillsReducer,
      ui: uiReducer,
      protect: protectReducer,
    },
  })

  store.dispatch(fetchSkills.fulfilled(skills, 'skills-req'))
  if (agentId !== null) store.dispatch(selectAgent(agentId))
  store.dispatch(enterBulkSelectMode())
  store.dispatch(selectAll(selectedNames))

  const onPrimaryAction = vi.fn()
  const screen = await render(
    <Provider store={store}>
      <SelectionToolbar
        onPrimaryAction={onPrimaryAction}
        onCopyAction={onCopyAction}
        agentDisplayName={agentDisplayName}
      />
    </Provider>,
  )

  return { screen, store, onPrimaryAction, setSearchQuery }
}

describe('SelectionToolbar', () => {
  test('shows "Select all visible ⌘A" in zero-selection state when bulk mode is entered', async () => {
    // Arrange — bulk mode active, nothing selected yet (zero-selection state)
    const options = {
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [],
      agentId: null,
    }

    // Act
    const { screen } = await renderToolbar(options)

    // Assert — toolbar visible with "Select all visible" as the only action
    await expect
      .element(screen.getByRole('group', { name: 'Bulk selection actions' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Select all visible' }))
      .toBeVisible()
    // Count text and destructive primary action absent at 0 selections
    expect(screen.getByText(/selected/).query()).toBeNull()
    expect(
      screen.getByRole('button', { name: /Move .* to app trash/i }).query(),
    ).toBeNull()
  })

  test('Clear empties the selection and transitions toolbar to zero-selection state', async () => {
    // Arrange — global view with one ticked skill so the toolbar is shown
    const { screen, store } = await renderToolbar({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    await expect
      .element(screen.getByRole('group', { name: 'Bulk selection actions' }))
      .toBeVisible()

    // Act — click Clear
    await screen.getByRole('button', { name: 'Clear' }).click()

    // Assert — selection emptied; toolbar remains visible in zero-selection state
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(screen.getByRole('group', { name: 'Bulk selection actions' }))
      .toBeVisible()
    // Destructive primary action is hidden at 0 selections
    expect(
      screen.getByRole('button', { name: /Move .* to app trash/i }).query(),
    ).toBeNull()
  })

  test('Select all visible ticks every eligible visible row', async () => {
    // Arrange — global view, two rows, only one currently ticked
    const { screen, store } = await renderToolbar({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })

    // Act — click Select all visible
    await screen.getByRole('button', { name: 'Select all visible' }).click()

    // Assert — both visible rows are now ticked
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha',
      'beta',
    ])
  })

  test('warns when selected rows are hidden by the filter or visible-but-ineligible', async () => {
    // Arrange — agent view: one valid (eligible) + one broken (visible,
    // ineligible) on screen, plus one hidden by the search filter.
    const { screen, store, setSearchQuery } = await renderToolbar({
      skills: [
        makeCursorSkill(toSkillName('alpha-valid'), 'valid'),
        makeCursorSkill(toSkillName('alpha-broken'), 'broken'),
        makeCursorSkill(toSkillName('zeta-hidden'), 'valid'),
      ],
      selectedNames: [
        toSkillName('alpha-valid'),
        toSkillName('alpha-broken'),
        toSkillName('zeta-hidden'),
      ],
      agentId: 'cursor',
    })

    // Act — narrow the visible list so 'zeta-hidden' drops out of the filter
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert — both advisory badges surface their counts
    await expect.element(screen.getByText('+1 hidden by filter')).toBeVisible()
    await expect.element(screen.getByText('+1 not eligible')).toBeVisible()
  })

  test('shows the bulk progress counter for large batches', async () => {
    // Arrange — global view with one ticked skill
    const { screen, store } = await renderToolbar({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    const { setBulkProgress } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act — emit progress for a batch at the >= 10 threshold
    store.dispatch(
      setBulkProgress({
        current: toBatchItemIndex(3),
        total: toBatchItemCount(12),
      }),
    )

    // Assert — the counter renders "current of total"
    await expect.element(screen.getByText('3 of 12')).toBeVisible()
  })

  test('offers a Copy to... button in global view when a copy handler is wired', async () => {
    // Arrange — global view with a copy callback supplied
    const onCopyAction = vi.fn()
    const { screen } = await renderToolbar({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
      onCopyAction,
    })
    const copyButton = screen.getByRole('button', {
      name: 'Copy selected skills to agents',
    })

    // Act — click the Copy to... button
    await copyButton.click()

    // Assert — the supplied copy handler fires
    expect(onCopyAction).toHaveBeenCalledTimes(1)
  })

  test('shows a destructive Delete action in global view', async () => {
    // Arrange — global view renders the destructive Delete primary action
    const { screen, onPrimaryAction } = await renderToolbar({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    const deleteButton = screen.getByRole('button', {
      name: /Move .* to app trash/i,
    })

    // Act — click the destructive primary action
    await deleteButton.click()

    // Assert — the destructive Delete button is present and fires its callback
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
  })

  test('shows a non-destructive Unlink action in agent view', async () => {
    // Arrange — agent view with a single eligible valid row
    const { screen, onPrimaryAction } = await renderToolbar({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: 'cursor',
      agentDisplayName: 'Cursor',
    })
    const unlinkButton = screen.getByRole('button', {
      name: 'Unlink selected skill from Cursor',
    })

    // Act — click the Unlink primary action
    await unlinkButton.click()

    // Assert — the primary callback fires for the non-destructive path
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
  })

  test('disables the primary action and shows a spinner while a bulk copy is in flight', async () => {
    // Arrange — global view with one ticked skill (bulk copy keeps the toolbar
    // mounted: unlike delete/unlink, its pending state does NOT exit bulk mode)
    const { screen, store } = await renderToolbar({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act — enter the bulk copy pending (busy) state
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )

    // Assert — the primary action is disabled AND its idle Trash2 icon is
    // swapped for the in-flight spinner (a regression that dropped the Loader2
    // branch would still satisfy the disabled check but fail the spinner one).
    const deleteButton = screen.getByRole('button', {
      name: /Move .* to app trash/i,
    })
    await expect.element(deleteButton).toBeDisabled()
    const spinner = deleteButton.element().querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
  })
})
