import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, test } from 'vitest'

import type { Skill } from '@/shared/types'
import {
  toAbsolutePath,
  toFileSizeBytes,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

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
    path: toAbsolutePath(`/home/user/.agents/skills/${name}`),
    filesystemIdentity: {
      kind: 'directory',
      dev: 1,
      ino,
      size: toFileSizeBytes(96),
      ctimeMs: 100,
      mtimeMs: 100,
    },
    symlinkCount: toSymlinkCount(0),
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
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert
    expect(store.getState().protect.items).toEqual([{ name: 'task' }])
  })

  test('locking the same skill twice keeps only one entry', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection({ name: toSkillName('task') }))
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  test('locks two distinct skills as separate entries', async () => {
    // Arrange
    const { addProtection } = await import('./protectSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(addProtection({ name: toSkillName('task') }))
    store.dispatch(addProtection({ name: toSkillName('browse') }))

    // Assert
    expect(store.getState().protect.items).toHaveLength(2)
  })

  test('unlocking a skill removes only that skill and leaves the rest protected', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: toSkillName('task') }))
    store.dispatch(addProtection({ name: toSkillName('browse') }))

    // Act
    store.dispatch(removeProtection(toSkillName('task')))

    // Assert
    const items = store.getState().protect.items
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ name: 'browse' })
  })

  test('leaves the list unchanged when unlocking a name that was never locked', async () => {
    // Arrange
    const { addProtection, removeProtection } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Act
    store.dispatch(removeProtection(toSkillName('nonexistent')))

    // Assert
    expect(store.getState().protect.items).toHaveLength(1)
  })

  test('reports a skill as protected only when it is in the protected list', async () => {
    // Arrange
    const { addProtection, selectIsProtected } = await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Act
    const isTaskProtected = selectIsProtected(
      store.getState(),
      toSkillName('task'),
    )
    const isOtherProtected = selectIsProtected(
      store.getState(),
      toSkillName('other'),
    )

    // Assert
    expect(isTaskProtected).toBe(true)
    expect(isOtherProtected).toBe(false)
  })

  test('selectProtectedNamesSet returns a Set containing all locked skill names', async () => {
    // Arrange
    const { addProtection, selectProtectedNamesSet } =
      await import('./protectSlice')
    const store = await createTestStore()
    store.dispatch(addProtection({ name: toSkillName('task') }))
    store.dispatch(addProtection({ name: toSkillName('browse') }))

    // Act
    const set = selectProtectedNamesSet(store.getState())

    // Assert
    expect(set.has(toSkillName('task'))).toBe(true)
    expect(set.has(toSkillName('browse'))).toBe(true)
    expect(set.has(toSkillName('other'))).toBe(false)
  })
})

describe('protectSlice rename reconciliation', () => {
  test('keeps a skill locked after it is renamed while the app is closed', async () => {
    // Arrange — locked while the directory was still called "task".
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({
        name: toSkillName('task'),
        identity: { dev: 1, ino: 10 },
      }),
    )

    // Act — next scan finds the same inode under a new name.
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('todo'), 10)],
        'scan-1',
      ),
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
    store.dispatch(addProtection({ name: toSkillName('task') }))

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('task'), 10)],
        'scan-1',
      ),
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
      addProtection({
        name: toSkillName('task'),
        identity: { dev: 1, ino: 10 },
      }),
    )

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('browse'), 20)],
        'scan-1',
      ),
    )

    // Assert — silently unlocking on a transient empty scan is the bug this
    // whole feature exists to prevent.
    expect(store.getState().protect.items).toEqual([
      { name: 'task', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('follows a chain of renames that swap names within one scan', async () => {
    // Arrange — both locked; while closed the user renamed "task" to "browse"
    // and the old "browse" to "write", so one scan carries the whole chain.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({
        name: toSkillName('task'),
        identity: { dev: 1, ino: 10 },
      }),
    )
    store.dispatch(
      addProtection({
        name: toSkillName('browse'),
        identity: { dev: 1, ino: 20 },
      }),
    )

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeScannedSkill(toSkillName('browse'), 10),
          makeScannedSkill(toSkillName('write'), 20),
        ],
        'scan-1',
      ),
    )

    // Assert — treating "browse" as taken because a lock started there would
    // strand inode 10 on "task" and leave the real "browse" deletable.
    expect(store.getState().protect.items).toEqual([
      { name: 'browse', identity: { dev: 1, ino: 10 } },
      { name: 'write', identity: { dev: 1, ino: 20 } },
    ])
  })

  test('does not point two locks at the same name when a rename lands on a locked one', async () => {
    // Arrange — both locked; while closed, "browse" was deleted and "task"
    // renamed into its place, so one inode now answers to a locked name and
    // inode 20 is gone from the scan entirely.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({
        name: toSkillName('task'),
        identity: { dev: 1, ino: 10 },
      }),
    )
    store.dispatch(
      addProtection({
        name: toSkillName('browse'),
        identity: { dev: 1, ino: 20 },
      }),
    )

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('browse'), 10)],
        'scan-1',
      ),
    )

    // Assert — inode 10 follows its rename onto "browse" and the lock on the
    // vanished inode 20 is dropped rather than shadowing it. Keeping both
    // would let Unlock silently take an entry the list can never show, and
    // keeping the stale one un-renamed would re-lock "browse" on the next scan.
    expect(store.getState().protect.items).toEqual([
      { name: 'browse', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('resolves a rename onto a locked name the same way whichever lock was added first', async () => {
    // Arrange — the same collision as above, locks added in the other order.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({
        name: toSkillName('browse'),
        identity: { dev: 1, ino: 20 },
      }),
    )
    store.dispatch(
      addProtection({
        name: toSkillName('task'),
        identity: { dev: 1, ino: 10 },
      }),
    )

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('browse'), 10)],
        'scan-1',
      ),
    )

    // Assert — insertion order is an accident of when the user clicked Lock;
    // settling the scanned inode first keeps the outcome the same either way.
    expect(store.getState().protect.items).toEqual([
      { name: 'browse', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('collapses a pre-scan lock onto the renamed skill it turned out to name', async () => {
    // Arrange — "foo" locked with its inode, plus a name-only lock on "bar";
    // while closed, "foo" was renamed to "bar", so both now mean one skill.
    const { addProtection } = await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({
        name: toSkillName('foo'),
        identity: { dev: 1, ino: 10 },
      }),
    )
    store.dispatch(addProtection({ name: toSkillName('bar') }))

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('bar'), 10)],
        'scan-1',
      ),
    )

    // Assert — one skill, one lock. Two entries sharing an inode would both
    // chase the same name on every later rename.
    expect(store.getState().protect.items).toEqual([
      { name: 'bar', identity: { dev: 1, ino: 10 } },
    ])
  })

  test('reuses the memoized protected-name set when a scan renames nothing', async () => {
    // Arrange
    const { addProtection, selectProtectedNamesSet } =
      await import('./protectSlice')
    const { fetchSkills } = await import('./skillsSlice')
    const store = await createTestStore()
    store.dispatch(
      addProtection({
        name: toSkillName('task'),
        identity: { dev: 1, ino: 10 },
      }),
    )
    const before = selectProtectedNamesSet(store.getState())

    // Act
    store.dispatch(
      fetchSkills.fulfilled(
        [makeScannedSkill(toSkillName('task'), 10)],
        'scan-1',
      ),
    )

    // Assert — a rebuilt Set on every scan would re-render the whole list.
    expect(selectProtectedNamesSet(store.getState())).toBe(before)
  })
})
