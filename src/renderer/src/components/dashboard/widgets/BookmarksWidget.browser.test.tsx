import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { HttpUrl, RepositoryId, SkillName } from '@/shared/types'

/**
 * Render the real BookmarksWidget reducer with one bookmark.
 * @param name - Skill name shown in the widget row.
 * @returns Render screen plus the backing Redux store.
 */
async function renderBookmarksWidget(
  name: SkillName = 'very-long-skill-name' as SkillName,
) {
  const [{ default: bookmarkReducer, addBookmark }, { BookmarksWidget }] =
    await Promise.all([
      import('@/renderer/src/redux/slices/bookmarkSlice'),
      import('./BookmarksWidget'),
    ])
  const store = configureStore({
    reducer: {
      bookmarks: bookmarkReducer,
    },
  })

  store.dispatch(
    addBookmark({
      name,
      repo: 'laststance/skills' as RepositoryId,
      url: 'https://skills.sh/very-long-skill-name' as HttpUrl,
    }),
  )

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 160 }}>
        <BookmarksWidget />
      </div>
    </Provider>,
  )

  return { screen, store }
}

describe('BookmarksWidget', () => {
  it('keeps the remove button compact and out of row layout', async () => {
    const { screen } = await renderBookmarksWidget()

    const removeButton = screen
      .getByRole('button', { name: /Remove bookmark very-long-skill-name/i })
      .element() as HTMLButtonElement
    expect(removeButton.classList.contains('absolute')).toBe(true)
    expect(removeButton.classList.contains('size-7')).toBe(true)
    expect(removeButton.classList.contains('min-w-11')).toBe(false)
    expect(removeButton.classList.contains('min-h-11')).toBe(false)
  })

  it('still removes the bookmark through the compact control', async () => {
    const { screen, store } = await renderBookmarksWidget('task' as SkillName)
    const removeButton = screen
      .getByRole('button', { name: /Remove bookmark task/i })
      .element() as HTMLButtonElement

    removeButton.click()

    expect(store.getState().bookmarks.items).toEqual([])
  })
})
