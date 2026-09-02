import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { repositoryId, type Skill } from '@/shared/types'

/**
 * Build a store with only the slices SearchBox subscribes to: `ui` for the
 * query/scope and `skills` for the repo suggestion list. SkillItem-style
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
    name,
    description: '',
    path: `/skills/${name}`,
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
    ...(source
      ? {
          source: repositoryId(source),
          sourceUrl: `https://github.com/${source}.git`,
        }
      : {}),
  }
}

/**
 * Render in Repo scope with two repos plus one Local skill loaded, so the
 * suggestion list has something to offer.
 */
async function renderRepoScopeSearchBox() {
  const { screen, store } = await renderSearchBox()
  const { fetchSkills } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { setSearchScope } = await import('@/renderer/src/redux/slices/uiSlice')
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
  store.dispatch(setSearchScope('repo'))
  return { screen, store }
}

describe('SearchBox scope toggle', () => {
  it('switches search to repository scope when the Repo toggle is clicked', async () => {
    // Arrange
    const { screen, store } = await renderSearchBox()

    // Act
    await screen.getByRole('radio', { name: /Search by repository/i }).click()

    // Assert
    await expect.poll(() => store.getState().ui.searchScope).toBe('repo')
  })

  it('filters skills by the text the user types into the search box', async () => {
    // Arrange
    const { screen, store } = await renderSearchBox()
    // The placeholder defaults to the name-mode copy.
    const input = screen.getByPlaceholder('Search skills...')

    // Act
    await input.fill('react')

    // Assert
    await expect.poll(() => store.getState().ui.searchQuery).toBe('react')
  })

  it('relabels the search box for screen readers as repository search when scope flips to repo', async () => {
    // Arrange
    const { screen, store } = await renderSearchBox()
    const { setSearchScope } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Assert: default is 'name'; verify both states so a regression renaming
    // one copy without the other (the original aria-label bug) is caught.
    await expect
      .element(screen.getByRole('searchbox', { name: 'Search skills by name' }))
      .toBeInTheDocument()

    // Act
    store.dispatch(setSearchScope('repo'))

    // Assert — repo scope also promotes the input to a combobox because it
    // owns the repository suggestion list.
    await expect
      .element(
        screen.getByRole('combobox', { name: 'Search skills by repository' }),
      )
      .toBeInTheDocument()
  })

  it('shows the repository search hint in the input when scope flips to repo', async () => {
    // Arrange
    const { screen, store } = await renderSearchBox()
    const { setSearchScope } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Assert: name-mode placeholder is shown before the scope changes.
    await expect
      .element(screen.getByPlaceholder('Search skills...'))
      .toBeInTheDocument()

    // Act
    store.dispatch(setSearchScope('repo'))

    // Assert
    await expect
      .element(screen.getByPlaceholder('Search by repository...'))
      .toBeInTheDocument()
  })
})

describe('SearchBox repository suggestions', () => {
  it('lists repository names and Local as suggestions when the repo search box is focused', async () => {
    // Arrange
    const { screen } = await renderRepoScopeSearchBox()

    // Act — clicking focuses the input, which opens the list
    await screen
      .getByRole('combobox', { name: 'Search skills by repository' })
      .click()

    // Assert — every repo in view plus the Local pseudo-repo
    await expect
      .element(screen.getByRole('listbox', { name: 'Repository suggestions' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('option', { name: 'microsoft/azure-skills' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('option', { name: 'vercel-labs/skills' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('option', { name: 'Local' }))
      .toBeInTheDocument()
  })

  it('narrows the suggestions to repositories containing the typed text', async () => {
    // Arrange
    const { screen } = await renderRepoScopeSearchBox()
    const input = screen.getByRole('combobox', {
      name: 'Search skills by repository',
    })

    // Act
    await input.fill('azure')

    // Assert
    await expect
      .element(screen.getByRole('option', { name: 'microsoft/azure-skills' }))
      .toBeInTheDocument()
    await expect
      .poll(() =>
        screen.getByRole('option', { name: 'vercel-labs/skills' }).query(),
      )
      .toBeNull()
    await expect
      .poll(() => screen.getByRole('option', { name: 'Local' }).query())
      .toBeNull()
  })

  it('fills the search query with the clicked suggestion and closes the list', async () => {
    // Arrange
    const { screen, store } = await renderRepoScopeSearchBox()
    await screen
      .getByRole('combobox', { name: 'Search skills by repository' })
      .click()

    // Act
    await screen.getByRole('option', { name: 'microsoft/azure-skills' }).click()

    // Assert
    await expect
      .poll(() => store.getState().ui.searchQuery)
      .toBe('microsoft/azure-skills')
    await expect.poll(() => screen.getByRole('listbox').query()).toBeNull()
  })

  it('reopens the list when the still-focused input is clicked again after a pick', async () => {
    // Arrange — a pick closes the list but leaves focus in the field, so a
    // second click fires no focus event; the click itself must reopen it.
    const { screen } = await renderRepoScopeSearchBox()
    await screen
      .getByRole('combobox', { name: 'Search skills by repository' })
      .click()
    await screen.getByRole('option', { name: 'microsoft/azure-skills' }).click()
    await expect.poll(() => screen.getByRole('listbox').query()).toBeNull()

    // Act — re-query the combobox from the post-pick DOM before clicking
    await screen
      .getByRole('combobox', { name: 'Search skills by repository' })
      .click()

    // Assert — the picked repo is the only entry that still matches the query
    await expect
      .element(screen.getByRole('option', { name: 'microsoft/azure-skills' }))
      .toBeInTheDocument()
  })

  it('sets the query to Local when the Local suggestion is chosen', async () => {
    // Arrange
    const { screen, store } = await renderRepoScopeSearchBox()
    await screen
      .getByRole('combobox', { name: 'Search skills by repository' })
      .click()

    // Act
    await screen.getByRole('option', { name: 'Local' }).click()

    // Assert — selectFilteredSkills matches source-less rows on this label
    await expect.poll(() => store.getState().ui.searchQuery).toBe('Local')
  })

  it('picks the first suggestion with ArrowDown then Enter from the keyboard', async () => {
    // Arrange
    const { screen, store } = await renderRepoScopeSearchBox()
    await screen
      .getByRole('combobox', { name: 'Search skills by repository' })
      .click()

    // Act
    await userEvent.keyboard('{ArrowDown}{Enter}')

    // Assert — options are A→Z, so the first one is microsoft/azure-skills
    await expect
      .poll(() => store.getState().ui.searchQuery)
      .toBe('microsoft/azure-skills')
  })

  it('offers no suggestion list while searching by skill name', async () => {
    // Arrange
    const { screen, store } = await renderRepoScopeSearchBox()
    const { setSearchScope } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(setSearchScope('name'))

    // Act
    await screen
      .getByRole('searchbox', { name: 'Search skills by name' })
      .click()

    // Assert
    await expect.poll(() => screen.getByRole('listbox').query()).toBeNull()
  })
})
