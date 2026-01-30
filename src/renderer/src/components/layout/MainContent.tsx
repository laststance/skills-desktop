import { X } from 'lucide-react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectAgent } from '../../redux/slices/uiSlice'
import { SearchBox } from '../skills/SearchBox'
import { SkillsList } from '../skills/SkillsList'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'

/**
 * Main content area (flexible width)
 * Contains search box, agent filter indicator, and skills list
 */
export function MainContent(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const { items: agents } = useAppSelector((state) => state.agents)

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)

  const handleClearFilter = (): void => {
    dispatch(selectAgent(null))
  }

  return (
    <main className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border">
        <SearchBox />
      </div>

      {/* Agent filter indicator */}
      {selectedAgent && (
        <div className="px-4 py-2 border-b border-border bg-primary/5 flex items-center justify-between">
          <span className="text-sm">
            Showing skills for{' '}
            <strong className="text-primary">{selectedAgent.name}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilter}
            className="h-6 px-2"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4">
          <SkillsList />
        </div>
      </ScrollArea>
    </main>
  )
}
