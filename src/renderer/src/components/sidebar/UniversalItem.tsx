import { Globe } from 'lucide-react'

import {
  AGENT_DEFINITIONS,
  UNIVERSAL_AGENT_IDS,
  UNIVERSAL_FILTER_ID,
} from '../../../../shared/constants'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectAgent } from '../../redux/slices/uiSlice'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/**
 * Display names of Universal agents, derived from AGENT_DEFINITIONS.
 * Precomputed at module level (static data, no re-computation needed).
 */
const UNIVERSAL_AGENT_NAMES = AGENT_DEFINITIONS.filter((a) =>
  (UNIVERSAL_AGENT_IDS as readonly string[]).includes(a.id),
).map((a) => a.name)

/**
 * Sidebar item for the Universal agents group.
 * Universal agents share ~/.agents/skills/ — skills there are accessible
 * to all Universal agents without symlinks.
 *
 * - Click: toggles the Universal filter (shows source skills)
 * - Tooltip: displays ~/.agents/skills/ path + list of Universal agent names
 *
 * @example
 * <UniversalItem />
 */
export function UniversalItem(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const isSelected = selectedAgentId === UNIVERSAL_FILTER_ID

  const handleClick = (): void => {
    dispatch(selectAgent(isSelected ? null : UNIVERSAL_FILTER_ID))
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors border-l-4 border-l-transparent cursor-pointer hover:bg-muted/50',
            isSelected && 'border-l-primary bg-primary/10',
          )}
          onClick={handleClick}
        >
          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Universal</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground mb-1">~/.agents/skills/</span>
          {UNIVERSAL_AGENT_NAMES.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
