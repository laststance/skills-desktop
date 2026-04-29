import { X } from 'lucide-react'
import React from 'react'

import { MIN_TOUCH_TARGET_PX } from '../../../../shared/constants'

import { Button } from './button'

interface FilterPillProps {
  /**
   * Trailing label content rendered after the static "Showing skills " prefix.
   * Pass JSX so callers can emphasize the filter target (e.g. wrap an agent
   * name in `<strong className="text-primary">`).
   */
  label: React.ReactNode
  /** Invoked when the user clicks the Clear button. */
  onClear: () => void
  /** Optional `data-testid` for browser-mode assertions. */
  testId?: string
}

/**
 * Horizontal filter indicator bar shown above the skills list when a
 * filter (agent, source repo, …) is active. Displays "Showing skills {label}"
 * with a Clear action that dispatches whatever reset reducer the caller wires.
 *
 * Multiple instances stack vertically — the agent pill and the source-repo
 * pill are orthogonal so both can render at once.
 *
 * @example
 *   <FilterPill
 *     label={<>for <strong className="text-primary">{agent.name}</strong></>}
 *     onClear={() => dispatch(selectAgent(null))}
 *     testId="agent-filter-pill"
 *   />
 */
export const FilterPill = React.memo(function FilterPill({
  label,
  onClear,
  testId,
}: FilterPillProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="px-4 py-2 border-b border-border bg-primary/5 flex items-center justify-between shrink-0"
    >
      <span className="text-sm">Showing skills {label}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        className="px-3"
      >
        <X className="h-3 w-3 mr-1" />
        Clear
      </Button>
    </div>
  )
})
