import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import type { RootState } from '@/renderer/src/redux/store'
import { repositoryId } from '@/shared/types'

async function createTestStore() {
  const { default: bookmarkReducer } = await import('./bookmarkSlice')
  return configureStore({ reducer: { bookmarks: bookmarkReducer } })
}

describe('bookmarkSlice', () => {
  it('starts with an empty saved list', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const items = store.getState().bookmarks.items

    // Assert
    expect(items).toEqual([])
  })

  it('bookmarking a skill makes it appear in the saved list with its repo and url', async () => {
    // Arrange
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    // Assert
    const items = store.getState().bookmarks.items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('task')
    expect(items[0].repo).toBe('vercel-labs/skills')
    expect(items[0].url).toBe('https://skills.sh/task')
    expect(items[0].bookmarkedAt).toBeTruthy()
  })

  it('stamps the saved skill with an ISO-formatted bookmark time', async () => {
    // Arrange
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    // Assert
    const { bookmarkedAt } = store.getState().bookmarks.items[0]
    expect(new Date(bookmarkedAt).toISOString()).toBe(bookmarkedAt)
  })

  it('keeps a single entry when the same skill is bookmarked twice', async () => {
    // Arrange
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()
    const payload = {
      name: 'task',
      repo: repositoryId('vercel-labs/skills'),
      url: 'https://skills.sh/task',
    }

    // Act
    store.dispatch(addBookmark(payload))
    store.dispatch(addBookmark(payload))

    // Assert
    expect(store.getState().bookmarks.items).toHaveLength(1)
  })

  it('saves two distinct skills as separate entries', async () => {
    // Arrange
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )
    store.dispatch(
      addBookmark({
        name: 'tdd',
        repo: repositoryId('pbakaus/impeccable'),
        url: 'https://skills.sh/tdd',
      }),
    )

    // Assert
    expect(store.getState().bookmarks.items).toHaveLength(2)
  })

  it('removing a bookmark drops only that skill and leaves the rest saved', async () => {
    // Arrange
    const { addBookmark, removeBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )
    store.dispatch(
      addBookmark({
        name: 'tdd',
        repo: repositoryId('pbakaus/impeccable'),
        url: 'https://skills.sh/tdd',
      }),
    )

    // Act
    store.dispatch(removeBookmark('task'))

    // Assert
    const items = store.getState().bookmarks.items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('tdd')
  })

  it('leaves the saved list unchanged when removing a name that was never bookmarked', async () => {
    // Arrange
    const { addBookmark, removeBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    // Act
    store.dispatch(removeBookmark('nonexistent'))

    // Assert
    expect(store.getState().bookmarks.items).toHaveLength(1)
  })

  it('exposes the saved skill through the bookmark items state', async () => {
    // Arrange
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    // Assert
    const items = store.getState().bookmarks.items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('task')
  })

  it('reports a skill as bookmarked only when it is in the saved list', async () => {
    // Arrange
    const { addBookmark, selectIsBookmarked } = await import('./bookmarkSlice')
    const store = await createTestStore()
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    // Act
    const isTaskBookmarked = selectIsBookmarked(
      store.getState() as unknown as RootState,
      'task',
    )
    const isOtherBookmarked = selectIsBookmarked(
      store.getState() as unknown as RootState,
      'other',
    )

    // Assert
    expect(isTaskBookmarked).toBe(true)
    expect(isOtherBookmarked).toBe(false)
  })
})
