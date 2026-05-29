import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

/**
 * Build a store with only the slices SearchBox subscribes to. SkillItem-style
 * fixture stores include `skills`, `agents`, `bookmarks` — none of which the
 * search box reads, so omitting them keeps the test surface tight.
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
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

    // Assert
    await expect
      .element(
        screen.getByRole('searchbox', { name: 'Search skills by repository' }),
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
