import { CheckCircle, AlertCircle, Circle } from 'lucide-react'

import type { SymlinkStatus } from '../../../../shared/types'
import { Badge } from '../ui/badge'

interface StatusBadgeProps {
  status: SymlinkStatus
  count?: number
}

const STATUS_CONFIG = {
  valid: {
    icon: CheckCircle,
    label: 'Valid',
    variant: 'valid' as const,
  },
  broken: {
    icon: AlertCircle,
    label: 'Broken',
    variant: 'broken' as const,
  },
  missing: {
    icon: Circle,
    label: 'Missing',
    variant: 'missing' as const,
  },
}

/**
 * Badge showing symlink status with optional count
 */
export function StatusBadge({
  status,
  count,
}: StatusBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {count !== undefined ? count : config.label}
    </Badge>
  )
}
