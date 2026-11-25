import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import {
  repositoryId,
  toAbsolutePath,
  toHttpUrl,
  toSkillName,
  toSymlinkCount,
  type Skill,
} from '@/shared/types'

/**
 * Build a store with only the slices SearchBox subscribes to: `ui` for the
 * query and `skills` for the repo suggestion list. SkillItem-style
 * fixture stores also carry `agents` and `bookmarks` — the search box never
 * reads them, so omitting them keeps the test surface tight.
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
    },
  })
}

async function renderSearchBox() {
  const store = await createStore()
  const { SearchBox } = await import('./SearchBox')
  const screen = await render(
    <Provider store={store}>
      <SearchBox />
    </Provider>,
  )
  return { screen, store }
}

/**
 * Minimal source-dir skill row; leaving `source` undefined models a hand-made
 * skill that the list labels "Local".
 */
function makeSkill(name: string, source?: string): Skill {
  return {
    name: toSkillName(name),
    description: '',
    path: toAbsolutePath(`/skills/${name}`),
    symlinkCount: toSymlinkCount(0),
    symlinks: [],
    isSource: true,
    isOrphan: false,
    ...(source
      ? {
          source: repositoryId(source),
          sourceUrl: toHttpUrl(`https://github.com/${source}.git`),
        }
      : {}),
  }
}

/**
 * Render with two repositories and a Local skill so the
 * suggestion list has something to offer.
 */
async function renderPopulatedSearchBox() {
  const { screen, store } = await renderSearchBox()
  const { fetchSkills } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  store.dispatch(
    fetchSkills.fulfilled(
      [
        makeSkill('task', 'vercel-labs/skills'),
        makeSkill('azure-ai', 'microsoft/azure-skills'),
        makeSkill('autofix'),
      ],
      'test-request',
    ),
  )
  return { screen, store }
}

describe('Installed search', () => {
  test('accepts a query for all three fields without choosing a search mode', async () => {
    // Arrange
    const { screen, store } = await renderSearchBox()
    const input = screen.getByRole('combobox', {
      name: 'Search skills by name, repository, or description',
    })

    // Act
    await input.fill('accessibility')

    // Assert
    await expect.element(input).toBeVisible()
    await expect
      .poll(() => store.getState().ui.searchQuery)
      .toBe('accessibility')
    expect(screen.getByRole('radio').query()).toBeNull()
  })
})

describe('SearchBox repository suggestions', () => {
  test('lists available repositories and Local when ArrowDown opens suggestions from an empty field', async () => {
    // Arrange
    const { screen } = await renderPopulatedSearchBox()

    // Act
    await screen.getByRole('combobox').click()

    await userEvent.keyboard('{ArrowDown}')

    // Assert — every repo in view plus the Local pseudo-repo
    await expect
      .element(screen.getByRole('listbox', { name: 'Repository suggestions' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: 'microsoft/azure-skills' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: 'vercel-labs/skills' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: 'Local' }))
      .toBeVisible()
  })

  test('narrows the suggestions to repositories containing the typed text', async () => {
    // Arrange
    const { screen } = await renderPopulatedSearchBox()
    const input = screen.getByRole('combobox')

    // Act
    await input.fill('azure')

    // Assert
    await expect
      .element(screen.getByRole('option', { name: 'microsoft/azure-skills' }))
      .toBeVisible()
    await expect
      .poll(() =>
        screen.getByRole('option', { name: 'vercel-labs/skills' }).query(),
      )
      .toBeNull()
    await expect
      .poll(() => screen.getByRole('option', { name: 'Local' }).query())
      .toBeNull()
  })

  test('fills the search query with the clicked suggestion and closes the list', async () => {
    // Arrange
    const { screen, store } = await renderPopulatedSearchBox()
    await screen.getByRole('combobox').fill('micro')

    // Act
    await screen.getByRole('option', { name: 'microsoft/azure-skills' }).click()

    // Assert
    await expect
      .poll(() => store.getState().ui.searchQuery)
      .toBe('microsoft/azure-skills')
    await expect.poll(() => screen.getByRole('listbox').query()).toBeNull()
  })

  test('reopens the list when the still-focused input is clicked again after a pick', async () => {
    // Arrange — a pick closes the list but leaves focus in the field, so a
    // second click fires no focus event; the click itself must reopen it.
    const { screen } = await renderPopulatedSearchBox()
    await screen.getByRole('combobox').fill('micro')
    await screen.getByRole('option', { name: 'microsoft/azure-skills' }).click()
    await expect.poll(() => screen.getByRole('listbox').query()).toBeNull()

    // Act — re-query the combobox from the post-pick DOM before clicking
    await screen.getByRole('combobox').click()

    // Assert — the picked repo is the only entry that still matches the query
    await expect
      .element(screen.getByRole('option', { name: 'microsoft/azure-skills' }))
      .toBeVisible()
  })

  test('sets the query to Local when the Local suggestion is chosen', async () => {
    // Arrange
    const { screen, store } = await renderPopulatedSearchBox()
    await screen.getByRole('combobox').fill('loc')

    // Act
    await screen.getByRole('option', { name: 'Local' }).click()

    // Assert — selectFilteredSkills matches source-less rows on this label
    await expect.poll(() => store.getState().ui.searchQuery).toBe('Local')
  })

  test('picks the first suggestion with ArrowDown then Enter from the keyboard', async () => {
    // Arrange
    const { screen, store } = await renderPopulatedSearchBox()
    await screen.getByRole('combobox').click()

    // Act
    await userEvent.keyboard('{ArrowDown}{Enter}')

    // Assert — options are A→Z, so the first one is microsoft/azure-skills
    await expect
      .poll(() => store.getState().ui.searchQuery)
      .toBe('microsoft/azure-skills')
  })

  test('keeps the results visible when the field is empty or no repository matches the text', async () => {
    // Arrange
    const { screen } = await renderPopulatedSearchBox()
    const input = screen.getByRole('combobox')

    // Act
    await input.click()

    // Assert
    await expect.element(input).toHaveAttribute('aria-expanded', 'false')

    // Act
    await input.fill('autofix')

    // Assert
    await expect.element(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('listbox').query()).toBeNull()
  })
})
