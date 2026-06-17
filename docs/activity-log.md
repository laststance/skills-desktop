# Activity Log (Activity Timeline)

The **activity log** is an append-only, cross-session record of skill mutations
(add / remove / sync). The dashboard's **Activity Timeline** widget renders it.

This implements [#178](https://github.com/laststance/skills-desktop/issues/178).
It replaces the widget's earlier placeholder, which could only show the _last
sync's_ per-item results (read from `uiSlice.syncResult`) and was wiped on
restart.

> **Status: dark.** The whole feature is gated behind
> `FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL` (`src/shared/featureFlags.ts`),
> which is **off**. With the flag off: the widget is hidden from the picker
> (`registry.ts` / `WidgetPicker.tsx`), the renderer sync hook is a no-op, and
> the main-process recorder is a no-op. Shipping this PR therefore changes **zero
> production behavior**. See [Acceptance criteria](#acceptance-criteria).

## Architecture

Persistence is **owned by the main process**, mirroring `settings.ts`. The
renderer never touches the file; it caches a copy in Redux and converges via an
IPC broadcast.

```text
 mutation handler (skills.ts / sync.ts)
        │  recordActivityEvents([...])         ← flag-gated, never throws
        ▼
 src/main/ipc/activity.ts
        │  appendActivityEvents(inputs)         broadcastTypedEvent('activity:changed', log)
        ▼                                                   │
 src/main/services/activityLog.ts                          │ (to every window)
        │  userData/activity-log.json (atomic temp+rename)  │
        ▼                                                   ▼
 disk  ◀── loadActivityLog() at boot          preload  window.electron.activity
                                                        │  .list()      → activity:list (hydrate)
                                                        │  .onChanged() → activity:changed (subscribe)
                                                        ▼
                                              useActivitySync() → activitySlice → widget
```

### Files

| Layer        | File                                                        | Role                                                                  |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Shared       | `src/shared/activityLog.ts`                                 | Zod `ActivityEventSchema`, types, `ActivityListOptions`               |
| Shared       | `src/shared/constants.ts`                                   | `MAX_ACTIVITY_EVENTS = 200`                                           |
| Main service | `src/main/services/activityLog.ts`                          | Load / cache / `appendActivityEvents` (atomic) / `listActivityEvents` |
| Main IPC     | `src/main/ipc/activity.ts`                                  | `recordActivityEvents` (gate + broadcast) + `activity:list` handler   |
| IPC contract | `ipc-channels.ts` / `ipc-contract.ts` / `ipc-schemas.ts`    | `activity:list`, `activity:changed` wiring                            |
| Emit sites   | `src/main/ipc/skills.ts`, `src/main/ipc/sync.ts`            | Call `recordActivityEvents` after a successful mutation               |
| Preload      | `src/preload/index.ts`                                      | `window.electron.activity.{list,onChanged}`                           |
| Renderer     | `redux/slices/activitySlice.ts`, `hooks/useActivitySync.ts` | Redux cache + sync hook                                               |
| Widget       | `components/dashboard/widgets/ActivityTimelineWidget.tsx`   | Render newest-first                                                   |

## Event shape

A deliberately **flat** record (not a discriminated union) so every row renders
through one code path — `type` only selects the icon + accent color.

```ts
interface ActivityEvent {
  id: string // uuid, stamped in main; React list key
  timestamp: string // ISO-8601, main-process clock
  type: 'created' | 'removed' | 'synced' | 'renamed'
  skillName: string // a skill name, or a scope label like 'Sync'
  agentName?: string // present for per-agent events; omitted for sync summaries
  detail?: string // e.g. '10 created · 1 replaced · 5 skipped'
}
```

Emit sites pass `ActivityEventInput` (`Omit<ActivityEvent, 'id' | 'timestamp'>`);
the main process stamps `id` (uuid) and `timestamp`.

## Recording rules

`recordActivityEvents` is **best-effort by contract**:

1. **Flag-gated** — returns immediately unless `ENABLE_DASHBOARD_EXPERIMENTAL`.
2. **Never throws** — wraps the write in try/catch + `console.warn`. A skill was
   already added/removed/synced on disk before we log it; a logging failure must
   not turn a successful mutation into a reported error.
3. **One atomic write per batch** — `appendActivityEvents` takes an array and
   writes once. Callers that touch many skill×agent pairs must summarize.

### Emit sites

| Mutation                | Handler                 | Events                                                                                                                         |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Add to agents (symlink) | `skills:createSymlinks` | one `created` per successful agent                                                                                             |
| Copy to agents          | `skills:copyToAgents`   | one `created` per successful agent                                                                                             |
| Delete skill            | `skills:deleteSkill`    | one `removed` (detail = cascaded agent links)                                                                                  |
| Bulk delete             | `skills:deleteSkills`   | one `removed` per deleted skill, batched into one write                                                                        |
| Sync                    | `sync:execute`          | exactly one `synced` **summary** (counts in `detail`) — never per-item, or a sync touching dozens of pairs would flood the log |

## Known gap: `renamed` has no emit site

`renamed` is in the schema and the widget renders it, but **nothing emits it**:
the app currently has no skill-rename feature (verified — no rename handler
exists). It is defined now so that when a rename feature lands it flows through
with zero schema/UI changes. This is an honest documented gap, not a stub that
pretends to work.

## Persistence

- File: `app.getPath('userData')/activity-log.json` (a newest-first JSON array).
- Capped ring buffer: trimmed to `MAX_ACTIVITY_EVENTS` (200) on every append;
  older events fall off the tail.
- Atomic write: temp file + `fs.rename`, so a crash mid-write can't corrupt it.
- Tolerant load: missing file (first launch) → `[]` silently; malformed file →
  `[]` + a `console.warn`. Activity history is non-critical and must never block
  startup.

## Acceptance criteria

From #178:

1. **Timeline shows events across operations + persists across restarts** — ✅
   (`activity-log.json` + `loadActivityLog` at boot; covered by
   `activityLog.test.ts` "persistence across restarts").
2. **Add / remove / sync / rename produce entries** — ✅ for add/remove/sync (see
   emit sites). `renamed` is schema- and UI-complete but unemitted — see
   [Known gap](#known-gap-renamed-has-no-emit-site).
3. **Widget promoted out of the experimental flag** — ⏸ **deferred to user
   sign-off.** This PR builds the full feature _behind_ the off flag so the
   widget's data path can be reviewed and tested without exposing it. Flipping
   `ENABLE_DASHBOARD_EXPERIMENTAL` is the one outward-facing change and is held
   back deliberately (same pattern as the deferred marketplace work). When the
   flag flips, the recorder, the sync hook, and the widget activate together.
