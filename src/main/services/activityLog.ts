import { promises as fs } from 'fs'
import { randomUUID } from 'node:crypto'
import { join } from 'path'

import { app } from 'electron'

import {
  ActivityLogSchema,
  type ActivityEvent,
  type ActivityEventInput,
  type ActivityListOptions,
  type ActivityLog,
} from '@/shared/activityLog'
import { MAX_ACTIVITY_EVENTS } from '@/shared/constants'

/**
 * In-memory newest-first cache of the activity log. Populated by
 * `loadActivityLog()` at boot and re-populated on every append. Renderers
 * receive a snapshot via `activity:list` and a stream of updates via the
 * `activity:changed` broadcast — they never read this file directly.
 */
let cache: ActivityLog | null = null

/**
 * Serializes {@link appendActivityEvents}: each append chains onto the previous
 * one so the read-modify-write inside it can't interleave. Two concurrent
 * appends would otherwise both read the same `cache`, and the second to finish
 * would overwrite the first — silently dropping events from both the cache and
 * the file (a lost update).
 */
let appendChain: Promise<unknown> = Promise.resolve()

/** Monotonic counter for unique temp-file names, so no two writes share a `.tmp`. */
let tempWriteCounter = 0

/**
 * Resolves the on-disk path for `activity-log.json`. Lazy because
 * `app.getPath('userData')` is only valid after `app.whenReady()`; calling it
 * at module-load time crashes Electron in tests.
 * @returns Absolute path to the activity-log file.
 * @example
 * activityLogFilePath() // => '/Users/me/Library/Application Support/skills-desktop/activity-log.json'
 */
function activityLogFilePath(): string {
  return join(app.getPath('userData'), 'activity-log.json')
}

/**
 * Reads `activity-log.json` from disk and validates it with Zod. On any failure
 * (missing file, malformed JSON, schema mismatch) an empty log is returned —
 * activity history is non-critical and must never block startup; the next
 * append writes a clean file.
 * @returns
 * - Validated newest-first events when the file exists and is valid.
 * - `[]` on first launch (ENOENT) or any read/parse error.
 * @example
 * await loadActivityLog() // => [{ id: '…', type: 'synced', skillName: 'Sync', … }]
 */
export async function loadActivityLog(): Promise<ActivityLog> {
  try {
    const raw = await fs.readFile(activityLogFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    const validated = ActivityLogSchema.parse(parsed)
    cache = validated
    return validated
  } catch (err) {
    // ENOENT (first launch) is expected; other errors get logged so a corrupt
    // file is visible in the dev console without blocking the widget.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[activity-log] failed to load, starting empty:', err)
    }
    cache = []
    return cache
  }
}

/**
 * Returns the in-memory activity-log snapshot, lazily seeding an empty log so
 * IPC handlers can read synchronously without awaiting `loadActivityLog`.
 * @returns The cached newest-first events (or `[]` if never loaded).
 * @example
 * getActivityLog() // => []
 */
export function getActivityLog(): ActivityLog {
  if (cache === null) {
    cache = []
  }
  return cache
}

/**
 * Returns a newest-first slice of the activity log for the `activity:list`
 * channel. Defaults to the whole capped log; `limit`/`offset` enable simple
 * paging without exposing the cache reference.
 * @param options - `{ limit, offset }`; both optional.
 * @returns The requested window of events (a fresh array, newest-first).
 * @example
 * listActivityEvents({ limit: 20 })          // => newest 20 events
 * listActivityEvents({ offset: 20, limit: 20 }) // => the next page
 */
export function listActivityEvents(options?: ActivityListOptions): ActivityLog {
  const all = getActivityLog()
  const offset = options?.offset ?? 0
  const limit = options?.limit ?? MAX_ACTIVITY_EVENTS
  return all.slice(offset, offset + limit)
}

/**
 * Appends a batch of events to the front of the log and persists the whole
 * file atomically (temp file + rename) so a crash mid-write cannot corrupt it.
 * One write per batch — callers that touch many skill×agent pairs in a single
 * operation (e.g. a sync) must pass one summary event, not N, to avoid both
 * flooding the log and fanning out N atomic rewrites. The capped ring buffer
 * drops the oldest events past `MAX_ACTIVITY_EVENTS`. Concurrent calls are
 * serialized (see {@link appendChain}) so an interleaved read-modify-write can
 * never lose an event.
 * @param inputs - Events without `id`/`timestamp`; both are stamped here.
 * @returns
 * - The new full newest-first log (also updates the cache).
 * - The unchanged current log when `inputs` is empty (no disk write).
 * @example
 * await appendActivityEvents([{ type: 'created', skillName: 'azure-ai', agentName: 'Claude Code' }])
 */
export async function appendActivityEvents(
  inputs: ActivityEventInput[],
): Promise<ActivityLog> {
  // Chain onto the previous append so the read-modify-write in
  // `appendActivityEventsUnsafe` is serialized — concurrent callers (e.g. a
  // sync and a delete firing from different windows) would otherwise lost-update
  // each other. The chain swallows the prior result/error so one failed append
  // cannot wedge every later one.
  const run = appendChain.then(async () => appendActivityEventsUnsafe(inputs))
  appendChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * The raw read-modify-write behind {@link appendActivityEvents}. NOT safe to
 * call concurrently — always go through `appendActivityEvents`, which serializes
 * it. Stamps `id`/`timestamp`, prepends the batch, caps the ring buffer, then
 * persists the whole file atomically (unique temp file + rename).
 * @param inputs - Events without `id`/`timestamp`; both are stamped here.
 * @returns The new full newest-first log, or the unchanged log for an empty batch.
 * @example
 * await appendActivityEventsUnsafe([{ type: 'created', skillName: 'azure-ai' }])
 */
async function appendActivityEventsUnsafe(
  inputs: ActivityEventInput[],
): Promise<ActivityLog> {
  const current = getActivityLog()
  if (inputs.length === 0) return current
  // One instant for the whole batch: the events are simultaneous from the
  // user's point of view, and a shared timestamp keeps a regenerated fixture
  // deterministic. Each event still gets its own uuid for a stable React key.
  const recordedAt = new Date().toISOString()
  const stamped: ActivityEvent[] = inputs.map((input) => ({
    ...input,
    id: randomUUID(),
    timestamp: recordedAt,
  }))
  // Newest-first ring buffer: the new batch goes to the front (input order
  // preserved within the batch), then the tail past the cap is dropped.
  const next = [...stamped, ...current].slice(0, MAX_ACTIVITY_EVENTS)
  const target = activityLogFilePath()
  // Unique temp name per write (pid + counter) so an unexpected overlap can't
  // have two writers racing on one `.tmp` before the atomic rename.
  const tempPath = `${target}.${process.pid}.${(tempWriteCounter += 1)}.tmp`
  // Ensure userData dir exists — first run on a fresh profile may lack it.
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(tempPath, target)
  cache = next
  return next
}
