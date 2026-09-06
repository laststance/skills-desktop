import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, test } from 'vitest'

import type { Skill } from '@/shared/types'

/**
 * Build a source-skill row the way `scanSourceSkills` does: named, and carrying
 * the `lstat` identity of its directory.
 * @param name - Name the row shows in the list.
 * @param ino - Inode of the skill directory; `dev` is fixed since one machine has one source volume.
 * @returns Complete Skill object
 * @example makeScannedSkill('task', 10)
 */
function makeScannedSkill(name: Skill['name'], ino: number): Skill {
  return {
    name,
    description: 'scanned',
    path: `/home/user/.agents/skills/${name}`,
    filesystemIdentity: {
      kind: 'directory',
      dev: 1,
      ino,
      size: 96,
      ctimeMs: 100,
      mtimeMs: 100,
    },
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
  }
}

async function createTestStore() {
  const { default: protectReducer } = await import('./protectSlice')
  return configureStore({ reducer: { protect: protectReducer } })
}

describe('protectSlice', () => {
  test('starts with an empty protected list', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const items = store.getState().protect.items

    // Assert
    expect(items).toEqual([])
  })

  test('locking a skill adds its name to the protected list', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection({ name: 'task' }))

    // Assert
    expect(store.getState().protect.items).toEqual([{ name: 'task' }])
  })

  test('locking the same skill twice keeps only one entry', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection({ name: 'task' }))
    store.dispatch(addProtection({ name: 'task' }))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  test('locks two distinct skills as separate entries', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection({ name: 'task' }))
    store.dispatch(addProtection({ name: 'browse' }))

    // Assert
    expect(store.getState().protect.items).toHaveLength(2)
  })

  test('unlocking a skill removes only that skill and leaves the rest protected', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: 'task' }))
    store.dispatch(addProtection({ name: 'browse' }))

    // Act
    store.dispatch(removeProtection('task'))

    // Assert
    const items = store.getState().protect.items
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ name: 'browse' })
  })

  test('leaves the list unchanged when unlocking a name that was never locked', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: 'task' }))

    // Act
    store.dispatch(removeProtection('nonexistent'))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  test('reports a skill as protected only when it is in the protected list', async () => {
    // Arrange
    const { addProtection, selectIsProtected } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: 'task' }))

    // Act
    const isTaskProtected = selectIsProtected(store.getState(), 'task')
    const isOtherProtected = selectIsProtected(store.getState(), 'other')

    // Assert
    expect(isTaskProtected).toBe(true)
    expect(isOtherProtected).toBe(false)
  })

  test('selectProtectedNamesSet returns a Set containing all locked skill names', async () => {
    // Arrange
    const { addProtection, selectProtectedNamesSet } =
      await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: 'task' }))
    store.dispatch(addProtection({ name: 'browse' }))

    // Act
    const set = selectProtectedNamesSet(store.getState())

    // Assert
    expect(set.has('task')).toBe(true)
    expect(set.has('browse')).toBe(true)
    expect(set.has('other')).toBe(false)
  })
})

describe('protectSlice rename reconciliation', () => {
  test('keeps a skill locked after it is renamed while the app is closed', async () => {
    // Arrange — locked while the directory was still called "task".
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({ name: 'task', identity: { dev: 1, ino: 10 } }),
    )

    // Act — next scan finds the same inode under a new name.
    store.dispatch(
      fetchSkills.fulfilled([makeScannedSkill('todo', 10)], 'scan-1'),
    )

    // Assert — the lock followed the rename instead of stranding on "task".
    expect(store.getState().protect.items).toEqual([
      { name: 'todo', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('records the inode of a lock taken before any scan so a later rename is followed', async () => {
    // Arrange — a v4-migrated lock, or one taken on a row with no identity.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: 'task' }))

    // Act
    store.dispatch(
      fetchSkills.fulfilled([makeScannedSkill('task', 10)], 'scan-1'),
    )

    // Assert
    expect(store.getState().protect.items).toEqual([
      { name: 'task', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('keeps a lock whose skill is missing from the scan instead of dropping it', async () => {
    // Arrange — an external drive with the skill on it is unplugged.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({ name: 'task', identity: { dev: 1, ino: 10 } }),
    )

    // Act
    store.dispatch(
      fetchSkills.fulfilled([makeScannedSkill('browse', 20)], 'scan-1'),
    )

    // Assert — silently unlocking on a transient empty scan is the bug this
    // whole feature exists to prevent.
    expect(store.getState().protect.items).toEqual([
      { name: 'task', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('does not collapse two locks into one when a rename lands on an already-locked name', async () => {
    // Arrange — both locked; while closed, "browse" was deleted and "task"
    // renamed into its place, so one inode now answers to a locked name.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({ name: 'task', identity: { dev: 1, ino: 10 } }),
    )
    store.dispatch(
      addProtection({ name: 'browse', identity: { dev: 1, ino: 20 } }),
    )

    // Act
    store.dispatch(
      fetchSkills.fulfilled([makeScannedSkill('browse', 10)], 'scan-1'),
    )

    // Assert — "browse" stays protected exactly once; unlocking it must not
    // take a second, invisible entry with it.
    expect(store.getState().protect.items).toEqual([
      { name: 'task', identity: { dev: 1, ino: 10 } },
      { name: 'browse', identity: { dev: 1, ino: 20 } },
    ])
  })

  test('reuses the memoized protected-name set when a scan renames nothing', async () => {
    // Arrange
    const { addProtection, selectProtectedNamesSet } =
      await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({ name: 'task', identity: { dev: 1, ino: 10 } }),
    )
    const before = selectProtectedNamesSet(store.getState())

    // Act
    store.dispatch(
      fetchSkills.fulfilled([makeScannedSkill('task', 10)], 'scan-1'),
    )

    // Assert — a rebuilt Set on every scan would re-render the whole list.
    expect(selectProtectedNamesSet(store.getState())).toBe(before)
  })
})
