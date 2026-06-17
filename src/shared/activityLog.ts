import { z } from 'zod'

/**
 * The kinds of activity the timeline records. `created` / `removed` / `synced`
 * have live emit sites in the IPC mutation handlers; `renamed` is defined for
 * completeness (the widget already renders it) but has NO emit site yet because
 * the app currently ships no skill-rename feature — the moment one lands it
 * flows through with zero schema/UI changes. See `docs/activity-log.md`.
 */
const ACTIVITY_EVENT_TYPES = [
  'created',
  'removed',
  'synced',
  'renamed',
] as const

/**
 * One persisted activity-log entry. A deliberately FLAT shape (not a
 * discriminated union) so every row renders through the same code path —
 * `<skillName> · <agentName?>` then `<type label> — <detail?>`. `type` only
 * selects the row's icon + accent color, so optional fields stay easier to
 * read/validate than per-variant payloads would.
 */
const ActivityEventSchema = z.object({
  /** Stable id (uuid) stamped in the main process; doubles as the React list key. */
  id: z.string().min(1),
  /** ISO-8601 instant the event was recorded, from the main-process clock. */
  timestamp: z.string().min(1),
  /** Which mutation produced the entry. */
  type: z.enum(ACTIVITY_EVENT_TYPES),
  /** Primary subject: a skill name, or a scope label like `Sync` for a sync summary. */
  skillName: z.string().min(1),
  /** Agent the mutation touched, when it maps to exactly one. Omitted for sync summaries. */
  agentName: z.string().min(1).optional(),
  /** Human-readable extra, e.g. `10 created · 1 replaced · 5 skipped` for a sync. */
  detail: z.string().min(1).optional(),
})

/** Validates the whole on-disk log: a newest-first array of events. */
export const ActivityLogSchema = z.array(ActivityEventSchema)

/** One persisted activity-log entry. @see ActivityEventSchema */
export type ActivityEvent = z.infer<typeof ActivityEventSchema>

/** The union of recorded activity kinds (`'created' | 'removed' | 'synced' | 'renamed'`). */
export type ActivityEventType = ActivityEvent['type']

/** Newest-first list of activity events, as persisted on disk and broadcast to renderers. */
export type ActivityLog = ActivityEvent[]

/**
 * Event payload as supplied by an emit site. The main process stamps `id` +
 * `timestamp`, so callers never pass them.
 * @example { type: 'created', skillName: 'azure-ai', agentName: 'Claude Code' }
 */
export type ActivityEventInput = Omit<ActivityEvent, 'id' | 'timestamp'>

/**
 * Query options for the `activity:list` IPC channel. Both fields are optional;
 * defaults return the newest `MAX_ACTIVITY_EVENTS` events with no offset.
 */
export interface ActivityListOptions {
  /** Max events to return, newest-first. */
  limit?: number
  /** How many newest events to skip before taking `limit` (simple paging). */
  offset?: number
}
