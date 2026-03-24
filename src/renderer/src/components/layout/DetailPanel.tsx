import { X } from 'lucide-react'
import React from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectSkill } from '../../redux/slices/skillsSlice'
import { SkillDetail } from '../skills/SkillDetail'

/**
 * Collapsible Inspector panel (Apple HIG pattern)
 * Shows selected skill details with file preview
 * Hidden by default, expands when a skill card is clicked
 */
export const DetailPanel = React.memo(
  function DetailPanel(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { selectedSkill } = useAppSelector((state) => state.skills)

    if (!selectedSkill) {
      return <aside className="h-full" />
    }

    return (
      <aside className="h-full border-l border-border bg-card flex flex-col overflow-hidden">
        {/* Draggable title bar area with close button */}
        <div className="h-8 drag-region shrink-0 flex items-center justify-end pr-2">
          <button
            type="button"
            onClick={() => dispatch(selectSkill(null))}
            className="no-drag p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close detail panel"
          >
            <X size={14} />
          </button>
        </div>
        <SkillDetail skill={selectedSkill} />
      </aside>
    )
  },
)
