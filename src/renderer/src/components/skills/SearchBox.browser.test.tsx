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
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')
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
  it('clicking the Repo toggle dispatches setSearchScope("repo")', async () => {
    const { screen, store } = await renderSearchBox()

    await screen.getByRole('radio', { name: /Search by repository/i }).click()

    await expect.poll(() => store.getState().ui.searchScope).toBe('repo')
  })

  it('typing in the input dispatches setSearchQuery', async () => {
    const { screen, store } = await renderSearchBox()

    // The placeholder defaults to the name-mode copy.
    const input = screen.getByPlaceholder('Search skills...')
    await input.fill('react')

    await expect.poll(() => store.getState().ui.searchQuery).toBe('react')
  })

  it('aria-label flips to the repository copy when scope=repo', async () => {
    const { screen, store } = await renderSearchBox()
    const { setSearchScope } = await import('../../redux/slices/uiSlice')

    // Default is 'name'; verify both states so a regression renaming one
    // copy without the other (the original aria-label bug) is caught.
    await expect
      .element(screen.getByRole('searchbox', { name: 'Search skills by name' }))
      .toBeInTheDocument()

    store.dispatch(setSearchScope('repo'))

    await expect
      .element(
        screen.getByRole('searchbox', { name: 'Search skills by repository' }),
      )
      .toBeInTheDocument()
  })

  it('placeholder flips to the repository copy when scope=repo', async () => {
    const { screen, store } = await renderSearchBox()
    const { setSearchScope } = await import('../../redux/slices/uiSlice')

    await expect
      .element(screen.getByPlaceholder('Search skills...'))
      .toBeInTheDocument()

    store.dispatch(setSearchScope('repo'))

    await expect
      .element(screen.getByPlaceholder('Search by repository...'))
      .toBeInTheDocument()
  })
})
