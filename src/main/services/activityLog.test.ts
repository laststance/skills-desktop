import { mkdtempSync, realpathSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { MAX_ACTIVITY_EVENTS } from '@/shared/constants'

import type * as ActivityLogModule from './activityLog'

// Mutable userData dir handed to `app.getPath('userData')`. Each test points it
// at a fresh tmpdir so the real fs read/write/rename/mkdir paths in
// activityLog.ts are exercised end-to-end, not a mock of them.
const electronUserData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected getPath(${name})`)
      }
      return electronUserData.dir
    },
  },
}))

/**
 * Re-imports activityLog.ts with its module-level `cache` reset to `null`,
 * which is how an app restart is simulated: a fresh import must re-read the log
 * from disk rather than serving a warm in-memory cache.
 * @returns Fresh activityLog module exports.
 * @example
 * const { loadActivityLog } = await importFreshActivityLog()
 */
async function importFreshActivityLog(): Promise<typeof ActivityLogModule> {
  vi.resetModules()
  return import('./activityLog')
}

describe('activity log persistence', () => {
  let userDataDir: string

  beforeEach(() => {
    // Arrange a clean userData dir for each test, then point the mocked
    // electron app at it.
    userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'activity-log-svc-')))
    electronUserData.dir = userDataDir
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  afterAll(() => {
    vi.clearAllMocks()
  })

  describe('loadActivityLog', () => {
    it('returns an empty log silently on first launch when activity-log.json is absent', async () => {
      // Arrange: a fresh userData dir with no file — the ENOENT path must NOT
      // warn because a missing file is expected before the first event.
      const { loadActivityLog } = await importFreshActivityLog()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Act
      const loaded = await loadActivityLog()

      // Assert
      expect(loaded).toEqual([])
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('falls back to an empty log and warns when activity-log.json holds malformed JSON', async () => {
      // Arrange: a syntactically broken file triggers a non-ENOENT error, which
      // must be logged so a corrupt file is visible in the dev console.
      const { loadActivityLog } = await importFreshActivityLog()
      await writeFile(
        join(userDataDir, 'activity-log.json'),
        '{ not json',
        'utf8',
      )
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Act
      const loaded = await loadActivityLog()

      // Assert
      expect(loaded).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(
        '[activity-log] failed to load, starting empty:',
        expect.anything(),
      )
      warnSpy.mockRestore()
    })
  })

  describe('appendActivityEvents', () => {
    it('stamps an id + timestamp on each event and writes it to disk', async () => {
      // Arrange
      const { appendActivityEvents } = await importFreshActivityLog()

      // Act
      const log = await appendActivityEvents([
        { type: 'created', skillName: 'azure-ai', agentName: 'Claude Code' },
      ])

      // Assert: the returned event is fully stamped and the same data is on disk.
      expect(log).toHaveLength(1)
      expect(log[0].id.length).toBeGreaterThan(0)
      expect(log[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(log[0].type).toBe('created')
      const onDisk = JSON.parse(
        await readFile(join(userDataDir, 'activity-log.json'), 'utf8'),
      )
      expect(onDisk[0].skillName).toBe('azure-ai')
      expect(onDisk[0].agentName).toBe('Claude Code')
    })

    it('prepends each new batch so the most recent event sorts first', async () => {
      // Arrange
      const { appendActivityEvents } = await importFreshActivityLog()
      await appendActivityEvents([
        { type: 'created', skillName: 'first-skill' },
      ])

      // Act
      const log = await appendActivityEvents([
        { type: 'removed', skillName: 'second-skill' },
      ])

      // Assert: newest-first ordering across separate appends.
      expect(log[0].skillName).toBe('second-skill')
      expect(log[1].skillName).toBe('first-skill')
    })

    it('caps the log at MAX_ACTIVITY_EVENTS, dropping the oldest event', async () => {
      // Arrange: fill the log to the cap, then append one more.
      const { appendActivityEvents } = await importFreshActivityLog()
      const fullBatch = Array.from(
        { length: MAX_ACTIVITY_EVENTS },
        (_unused, index) => ({
          type: 'created' as const,
          skillName: `batch-${index}`,
        }),
      )
      await appendActivityEvents(fullBatch)

      // Act: one more event past the cap.
      const log = await appendActivityEvents([
        { type: 'removed', skillName: 'newest-skill' },
      ])

      // Assert: still capped, newest at the front, and the oldest fell off.
      expect(log).toHaveLength(MAX_ACTIVITY_EVENTS)
      expect(log[0].skillName).toBe('newest-skill')
      expect(
        log.some(
          (event) => event.skillName === `batch-${MAX_ACTIVITY_EVENTS - 1}`,
        ),
      ).toBe(false)
    })

    it('writes no file and returns the current log when given an empty batch', async () => {
      // Arrange
      const { appendActivityEvents } = await importFreshActivityLog()

      // Act
      const log = await appendActivityEvents([])

      // Assert: the no-op short-circuits before any disk write.
      expect(log).toEqual([])
      await expect(
        readFile(join(userDataDir, 'activity-log.json'), 'utf8'),
      ).rejects.toThrow()
    })

    it('keeps every event when many appends race instead of dropping all but the last', async () => {
      // Arrange
      const { appendActivityEvents, getActivityLog } =
        await importFreshActivityLog()

      // Act: fire 20 appends at once WITHOUT awaiting between them — the exact
      // interleaving where a naive read-modify-write lets each call read the
      // same starting log and the last writer clobbers the other 19.
      await Promise.all(
        Array.from({ length: 20 }, async (_unused, index) =>
          appendActivityEvents([
            { type: 'created', skillName: `concurrent-${index}` },
          ]),
        ),
      )

      // Assert: all 20 distinct events survived in both the cache and on disk.
      const log = getActivityLog()
      expect(log).toHaveLength(20)
      expect(new Set(log.map((event) => event.skillName)).size).toBe(20)
      const onDisk = JSON.parse(
        await readFile(join(userDataDir, 'activity-log.json'), 'utf8'),
      )
      expect(onDisk).toHaveLength(20)
    })

    it('keeps the queue alive so an append after a failed one still persists', async () => {
      // Arrange: point userData at a regular FILE so the first append's mkdir
      // rejects — without the chain's error-swallow this would wedge every
      // later append.
      const { appendActivityEvents } = await importFreshActivityLog()
      const blockingFile = join(userDataDir, 'blocker')
      await writeFile(blockingFile, 'x', 'utf8')
      electronUserData.dir = blockingFile

      // Act: the first append fails...
      await expect(
        appendActivityEvents([{ type: 'created', skillName: 'doomed' }]),
      ).rejects.toThrow()

      // ...then a real dir is restored and a second append runs.
      electronUserData.dir = userDataDir
      const log = await appendActivityEvents([
        { type: 'created', skillName: 'after-failure' },
      ])

      // Assert: the post-failure append succeeded and persisted (queue not wedged).
      expect(log.some((event) => event.skillName === 'after-failure')).toBe(
        true,
      )
      const onDisk = JSON.parse(
        await readFile(join(userDataDir, 'activity-log.json'), 'utf8'),
      )
      expect(
        onDisk.some(
          (event: { skillName: string }) => event.skillName === 'after-failure',
        ),
      ).toBe(true)
    })
  })

  describe('listActivityEvents', () => {
    it('returns a newest-first page bounded by limit and offset', async () => {
      // Arrange: three separate appends → on-disk order [c, b, a].
      const { appendActivityEvents, listActivityEvents } =
        await importFreshActivityLog()
      await appendActivityEvents([{ type: 'created', skillName: 'a' }])
      await appendActivityEvents([{ type: 'created', skillName: 'b' }])
      await appendActivityEvents([{ type: 'created', skillName: 'c' }])

      // Act
      const firstPage = listActivityEvents({ limit: 2 })
      const secondPage = listActivityEvents({ offset: 2, limit: 2 })

      // Assert
      expect(firstPage.map((event) => event.skillName)).toEqual(['c', 'b'])
      expect(secondPage.map((event) => event.skillName)).toEqual(['a'])
    })
  })

  describe('persistence across restarts', () => {
    it('reloads the events written by a previous app session', async () => {
      // Arrange: session 1 records two events.
      const session1 = await importFreshActivityLog()
      await session1.appendActivityEvents([
        {
          type: 'synced',
          skillName: 'Sync',
          detail: '3 created · 0 replaced · 1 skipped',
        },
        { type: 'removed', skillName: 'old-skill' },
      ])

      // Act: simulate an app restart (fresh import resets the in-memory cache to
      // null, so load must read the file written by session 1).
      const session2 = await importFreshActivityLog()
      const reloaded = await session2.loadActivityLog()

      // Assert: the events survived the restart, newest-first, intact.
      expect(reloaded).toHaveLength(2)
      expect(reloaded[0]).toMatchObject({
        type: 'synced',
        skillName: 'Sync',
        detail: '3 created · 0 replaced · 1 skipped',
      })
      expect(reloaded[1]).toMatchObject({
        type: 'removed',
        skillName: 'old-skill',
      })
    })
  })
})
