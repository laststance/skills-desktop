import { CheckCircle, AlertCircle, Circle } from 'lucide-react'

import type { SymlinkInfo } from '../../../../shared/types'
import { cn } from '../../lib/utils'

interface SymlinkStatusProps {
  symlink: SymlinkInfo
}

const STATUS_STYLES = {
  valid: {
    icon: CheckCircle,
    iconClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/10',
  },
  broken: {
    icon: AlertCircle,
    iconClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
  },
  missing: {
    icon: Circle,
    iconClass: 'text-slate-400',
    bgClass: 'bg-slate-500/10',
  },
}

/**
 * Single symlink status row for an agent
 */
export function SymlinkStatus({
  symlink,
}: SymlinkStatusProps): React.ReactElement {
  const style = STATUS_STYLES[symlink.status]
  const Icon = style.icon

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md',
        style.bgClass,
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', style.iconClass)} />
      <span className="text-sm flex-1 truncate">{symlink.agentName}</span>
      <span className="text-xs text-muted-foreground capitalize">
        {symlink.status}
      </span>
    </div>
  )
}
