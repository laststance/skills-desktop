import {
  AlertCircle,
  FileClock,
  MinusCircle,
  Plus,
  Replace,
} from 'lucide-react'
import React from 'react'
import { match } from 'ts-pattern'

import type {
  SyncResultAction,
  SyncResultItem,
} from '../../../../../shared/types'
import { useAppSelector } from '../../../redux/hooks'
import { selectSyncResult } from '../../../redux/slices/uiSlice'

// ----------------------------------------------------------------------------
// Action → visual mapping. Centralizes the icon + color per action so the
// row renderer stays small.
// ----------------------------------------------------------------------------

interface ActionVisual {
  icon: React.ComponentType<{ className?: string }>
  accentClass: string
  label: string
}

const ACTION_VISUALS: Record<SyncResultAction, ActionVisual> = {
  created: { icon: Plus, accentClass: 'text-primary', label: 'created' },
  replaced: { icon: Replace, accentClass: 'text-amber-400', label: 'replaced' },
  skipped: {
    icon: MinusCircle,
    accentClass: 'text-muted-foreground',
    label: 'skipped',
  },
  error: { icon: AlertCircle, accentClass: 'text-destructive', label: 'error' },
}

// ----------------------------------------------------------------------------
// TimelineRow — one log line.
// ----------------------------------------------------------------------------

interface TimelineRowProps {
  item: SyncResultItem
}

const TimelineRow = React.memo(function TimelineRow({
  item,
}: TimelineRowProps): React.ReactElement {
  const visual = ACTION_VISUALS[item.action]
  const Icon = visual.icon

  // Error rows carry a message; non-error rows don't, so match on the
  // discriminated union to pull the detail text safely.
  const detailText = match(item)
    .with({ action: 'error' }, (errorItem) => errorItem.error)
    .otherwise(() => null)

  return (
    <li className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-muted/50">
      <Icon
        className={`h-3 w-3 mt-0.5 shrink-0 ${visual.accentClass}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-[11px] text-foreground truncate">
          <span className="font-medium">{item.skillName}</span>
          <span className="text-muted-foreground"> · {item.agentName}</span>
        </span>
        <span
          className={`text-[10px] ${visual.accentClass} uppercase tracking-wide`}
        >
          {visual.label}
          {detailText && (
            <span className="normal-case tracking-normal text-muted-foreground">
              {' — '}
              {detailText}
            </span>
          )}
        </span>
      </div>
    </li>
  )
})

/**
 * Activity Timeline widget body (experimental).
 *
 * Today this surface only has one data source: the last sync execution
 * (`uiSlice.syncResult.details`). A proper timeline would need main-process
 * event tracking for add/remove/sync/rename — see `docs/activity-log.md`
 * (TODO). For now the widget shows the most recent sync's per-item actions
 * so the ecosystem hook exists and the widget isn't empty when
 * `ENABLE_DASHBOARD_EXPERIMENTAL` is on.
 */
export const ActivityTimelineWidget = React.memo(
  function ActivityTimelineWidget(): React.ReactElement {
    const syncResult = useAppSelector(selectSyncResult)

    if (!syncResult || syncResult.details.length === 0) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
          <FileClock
            className="h-5 w-5 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">No recent activity</p>
          <p className="text-[10px] text-muted-foreground/70">
            Run Sync to see per-item results here.
          </p>
        </div>
      )
    }

    return (
      <div className="h-full w-full overflow-y-auto py-1">
        <ul className="flex flex-col gap-0.5 px-1">
          {syncResult.details.map((item, index) => (
            <TimelineRow
              // Sync results aren't guaranteed to have unique (skill,agent)
              // pairs across actions (e.g., replaced then errored in edge cases),
              // so the array index is the reliable stable key.
              key={`${item.skillName}-${item.agentName}-${index}`}
              item={item}
            />
          ))}
        </ul>
      </div>
    )
  },
)
