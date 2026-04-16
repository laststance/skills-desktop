import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import { repositoryId } from '../../../../shared/types'
import type { RootState } from '../store'

async function createTestStore() {
  const { default: bookmarkReducer } = await import('./bookmarkSlice')
  return configureStore({ reducer: { bookmarks: bookmarkReducer } })
}

describe('bookmarkSlice', () => {
  it('has correct initial state', async () => {
    const store = await createTestStore()
    expect(store.getState().bookmarks.items).toEqual([])
  })

  it('addBookmark adds a skill to bookmarks', async () => {
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    const items = store.getState().bookmarks.items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('task')
    expect(items[0].repo).toBe('vercel-labs/skills')
    expect(items[0].url).toBe('https://skills.sh/task')
    expect(items[0].bookmarkedAt).toBeTruthy()
  })

  it('addBookmark sets bookmarkedAt as ISO string', async () => {
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    const { bookmarkedAt } = store.getState().bookmarks.items[0]
    expect(new Date(bookmarkedAt).toISOString()).toBe(bookmarkedAt)
  })

  it('addBookmark ignores duplicate by name', async () => {
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    const payload = {
      name: 'task',
      repo: repositoryId('vercel-labs/skills'),
      url: 'https://skills.sh/task',
    }
    store.dispatch(addBookmark(payload))
    store.dispatch(addBookmark(payload))

    expect(store.getState().bookmarks.items).toHaveLength(1)
  })

  it('addBookmark allows different skills', async () => {
    const { addBookmark } = await import('./bookmarkSlice')
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

    expect(store.getState().bookmarks.items).toHaveLength(2)
  })

  it('removeBookmark removes by name', async () => {
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

    store.dispatch(removeBookmark('task'))

    const items = store.getState().bookmarks.items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('tdd')
  })

  it('removeBookmark is no-op for non-existent name', async () => {
    const { addBookmark, removeBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    store.dispatch(removeBookmark('nonexistent'))

    expect(store.getState().bookmarks.items).toHaveLength(1)
  })

  it('selectBookmarkItems returns items array', async () => {
    const { addBookmark } = await import('./bookmarkSlice')
    const store = await createTestStore()

    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    const items = store.getState().bookmarks.items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('task')
  })

  it('selectIsBookmarked returns true for bookmarked skill', async () => {
    const { addBookmark, selectIsBookmarked } = await import('./bookmarkSlice')
    const store = await createTestStore()

    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    expect(
      selectIsBookmarked(store.getState() as unknown as RootState, 'task'),
    ).toBe(true)
    expect(
      selectIsBookmarked(store.getState() as unknown as RootState, 'other'),
    ).toBe(false)
  })
})
