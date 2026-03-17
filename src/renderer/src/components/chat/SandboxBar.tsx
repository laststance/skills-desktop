import { FlaskConical, X } from 'lucide-react'

import { Button } from '../ui/button'

interface SandboxBarProps {
  sandboxPath: string
  skillName: string | null
  onClose: () => void
}

/**
 * Status bar showing active sandbox environment
 * Displays sandbox path and skill name with close button
 */
export function SandboxBar({
  sandboxPath,
  skillName,
  onClose,
}: SandboxBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
      <FlaskConical className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-emerald-400 truncate">
          Sandbox{skillName ? `: ${skillName}` : ''}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">
          {sandboxPath}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 hover:bg-emerald-500/20"
        onClick={onClose}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
