import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import type { RootState } from '@/renderer/src/redux/store'
import type { SkillName } from '@/shared/types'

async function createTestStore() {
  const { default: protectReducer } = await import('./protectSlice')
  return configureStore({ reducer: { protect: protectReducer } })
}

describe('protectSlice', () => {
  it('starts with an empty protected list', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const items = store.getState().protect.items

    // Assert
    expect(items).toEqual([])
  })

  it('locking a skill adds its name to the protected list', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection('task' as SkillName))

    // Assert
    expect(store.getState().protect.items).toEqual(['task'])
  })

  it('locking the same skill twice keeps only one entry', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection('task' as SkillName))
    store.dispatch(addProtection('task' as SkillName))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  it('locks two distinct skills as separate entries', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection('task' as SkillName))
    store.dispatch(addProtection('browse' as SkillName))

    // Assert
    expect(store.getState().protect.items).toHaveLength(2)
  })

  it('unlocking a skill removes only that skill and leaves the rest protected', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task' as SkillName))
    store.dispatch(addProtection('browse' as SkillName))

    // Act
    store.dispatch(removeProtection('task' as SkillName))

    // Assert
    const items = store.getState().protect.items
    expect(items).toHaveLength(1)
    expect(items[0]).toBe('browse')
  })

  it('leaves the list unchanged when unlocking a name that was never locked', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task' as SkillName))

    // Act
    store.dispatch(removeProtection('nonexistent' as SkillName))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  it('reports a skill as protected only when it is in the protected list', async () => {
    // Arrange
    const { addProtection, selectIsProtected } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task' as SkillName))

    // Act
    const isTaskProtected = selectIsProtected(
      store.getState() as unknown as RootState,
      'task' as SkillName,
    )
    const isOtherProtected = selectIsProtected(
      store.getState() as unknown as RootState,
      'other' as SkillName,
    )

    // Assert
    expect(isTaskProtected).toBe(true)
    expect(isOtherProtected).toBe(false)
  })

  it('selectProtectedNamesSet returns a Set containing all locked skill names', async () => {
    // Arrange
    const { addProtection, selectProtectedNamesSet } =
      await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task' as SkillName))
    store.dispatch(addProtection('browse' as SkillName))

    // Act
    const set = selectProtectedNamesSet(
      store.getState() as unknown as RootState,
    )

    // Assert
    expect(set.has('task' as SkillName)).toBe(true)
    expect(set.has('browse' as SkillName)).toBe(true)
    expect(set.has('other' as SkillName)).toBe(false)
  })
})
