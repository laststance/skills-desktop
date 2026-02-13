import { CheckCircle, AlertCircle, Circle } from 'lucide-react'

import type { SymlinkStatus } from '../../../../shared/types'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface StatusBadgeProps {
  status: SymlinkStatus
  count?: number
  /** Agent names to display in tooltip (e.g. ["Claude", "Cursor"]) */
  agentNames?: string[]
}

const STATUS_CONFIG = {
  valid: {
    icon: CheckCircle,
    label: 'Valid',
    variant: 'valid' as const,
    tooltip: 'Linked to agent',
  },
  broken: {
    icon: AlertCircle,
    label: 'Broken',
    variant: 'broken' as const,
    tooltip: 'Broken symlink',
  },
  missing: {
    icon: Circle,
    label: 'Missing',
    variant: 'missing' as const,
    tooltip: 'Not linked',
  },
}

/**
 * Badge showing symlink status with optional count.
 * Displays tooltip on hover explaining the status meaning.
 * @param status - The symlink status: 'valid' | 'broken' | 'missing'
 * @param count - Optional count to display instead of label
 * @param agentNames - Agent names to list in tooltip
 * @returns Badge with icon and tooltip
 * @example
 * <StatusBadge status="valid" count={3} agentNames={["Claude", "Cursor", "Windsurf"]} />
 * // Shows: ✓ 3 with tooltip listing "Claude, Cursor, Windsurf"
 */
export function StatusBadge({
  status,
  count,
  agentNames,
}: StatusBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={config.variant} className="gap-1 cursor-default">
          <Icon className="h-3 w-3" aria-hidden="true" />
          <span>{count !== undefined ? count : config.label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {agentNames && agentNames.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {agentNames.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        ) : (
          <span>{config.tooltip}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
