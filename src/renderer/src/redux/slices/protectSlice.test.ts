import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

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
    store.dispatch(addProtection('task'))

    // Assert
    expect(store.getState().protect.items).toEqual(['task'])
  })

  it('locking the same skill twice keeps only one entry', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection('task'))
    store.dispatch(addProtection('task'))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  it('locks two distinct skills as separate entries', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection('task'))
    store.dispatch(addProtection('browse'))

    // Assert
    expect(store.getState().protect.items).toHaveLength(2)
  })

  it('unlocking a skill removes only that skill and leaves the rest protected', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task'))
    store.dispatch(addProtection('browse'))

    // Act
    store.dispatch(removeProtection('task'))

    // Assert
    const items = store.getState().protect.items
    expect(items).toHaveLength(1)
    expect(items[0]).toBe('browse')
  })

  it('leaves the list unchanged when unlocking a name that was never locked', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task'))

    // Act
    store.dispatch(removeProtection('nonexistent'))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  it('reports a skill as protected only when it is in the protected list', async () => {
    // Arrange
    const { addProtection, selectIsProtected } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task'))

    // Act
    const isTaskProtected = selectIsProtected(store.getState(), 'task')
    const isOtherProtected = selectIsProtected(store.getState(), 'other')

    // Assert
    expect(isTaskProtected).toBe(true)
    expect(isOtherProtected).toBe(false)
  })

  it('selectProtectedNamesSet returns a Set containing all locked skill names', async () => {
    // Arrange
    const { addProtection, selectProtectedNamesSet } =
      await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection('task'))
    store.dispatch(addProtection('browse'))

    // Act
    const set = selectProtectedNamesSet(store.getState())

    // Assert
    expect(set.has('task')).toBe(true)
    expect(set.has('browse')).toBe(true)
    expect(set.has('other')).toBe(false)
  })
})
