import { FileClock, MinusCircle, Plus, RefreshCw, Replace } from 'lucide-react'
import React from 'react'

import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectActivityEvents } from '@/renderer/src/redux/slices/activitySlice'
import type { ActivityEvent, ActivityEventType } from '@/shared/activityLog'

// ----------------------------------------------------------------------------
// Event type → visual mapping. A Record (not a ts-pattern `match`) because each
// row needs only a constant icon/color/label lookup — the row body is identical
// across types, so there is nothing to branch on.
// ----------------------------------------------------------------------------

interface ActionVisual {
  icon: React.ComponentType<{ className?: string }>
  accentClass: string
  label: string
}

const ACTION_VISUALS: Record<ActivityEventType, ActionVisual> = {
  created: { icon: Plus, accentClass: 'text-primary', label: 'created' },
  removed: {
    icon: MinusCircle,
    accentClass: 'text-destructive',
    label: 'removed',
  },
  // `synced` is a routine success event, NOT a needs-review/broken state, so it
  // must NOT borrow `text-amber-400` (the app-wide broken/inaccessible hue).
  // DESIGN.md caps amber at exactly two meanings (broken + bookmark) and names
  // `text-foreground` as the safe default for a semantic with no dedicated hue.
  synced: { icon: RefreshCw, accentClass: 'text-foreground', label: 'synced' },
  renamed: {
    icon: Replace,
    accentClass: 'text-muted-foreground',
    label: 'renamed',
  },
}

// ----------------------------------------------------------------------------
// TimelineRow — one log line.
// ----------------------------------------------------------------------------

interface TimelineRowProps {
  event: ActivityEvent
}

const TimelineRow = React.memo(function TimelineRow({
  event,
}: TimelineRowProps): React.ReactElement {
  const visual = ACTION_VISUALS[event.type]
  const Icon = visual.icon

  return (
    <li className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-muted/50">
      <Icon
        className={`h-3 w-3 mt-0.5 shrink-0 ${visual.accentClass}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-[11px] text-foreground truncate">
          <span className="font-medium">{event.skillName}</span>
          {/* Agent is only present for per-agent events (add/remove); a sync
              summary touches many agents, so the separator is omitted there. */}
          {event.agentName && (
            <span className="text-muted-foreground"> · {event.agentName}</span>
          )}
        </span>
        <span
          className={`text-[10px] ${visual.accentClass} uppercase tracking-wide`}
        >
          {visual.label}
          {event.detail && (
            <span className="normal-case tracking-normal text-muted-foreground">
              {' — '}
              {event.detail}
            </span>
          )}
        </span>
      </div>
    </li>
  )
})

/**
 * Activity Timeline widget body. Renders the persisted activity log
 * (newest-first) — add / remove / sync events surfaced from the main-process
 * store via `useActivitySync`. Replaces the earlier last-sync-only placeholder
 * with a real cross-session feed. Gated behind `ENABLE_DASHBOARD_EXPERIMENTAL`
 * in the widget registry, so it stays hidden from the picker until that flag
 * flips. See `docs/activity-log.md`.
 */
export const ActivityTimelineWidget = React.memo(
  function ActivityTimelineWidget(): React.ReactElement {
    const events = useAppSelector(selectActivityEvents)

    if (events.length === 0) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
          <FileClock
            className="h-5 w-5 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">No recent activity</p>
          <p className="text-[10px] text-muted-foreground/70">
            Add, remove, or sync skills to see activity here.
          </p>
        </div>
      )
    }

    return (
      <div className="h-full w-full overflow-y-auto py-1">
        <ul className="flex flex-col gap-0.5 px-1">
          {events.map((event) => (
            // event.id is a stable uuid stamped by the main process — a proper
            // key, unlike the index-based fallback the sync-only version needed.
            <TimelineRow key={event.id} event={event} />
          ))}
        </ul>
      </div>
    )
  },
)
