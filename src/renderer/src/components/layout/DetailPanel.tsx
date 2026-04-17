import { X } from 'lucide-react'
import React from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectSkill } from '../../redux/slices/skillsSlice'
import { DashboardCanvas } from '../dashboard/DashboardCanvas'
import { MarketplaceDetailPanel } from '../marketplace/MarketplaceDetailPanel'
import { SkillDetail } from '../skills/SkillDetail'

/**
 * Collapsible Inspector panel (Apple HIG pattern)
 * Routes between:
 * - Installed tab + skill selected → SkillDetail
 * - Installed tab + no skill       → DashboardCanvas (widgets)
 * - Marketplace tab                → MarketplaceDetailPanel
 */
export const DetailPanel = React.memo(
  function DetailPanel(): React.ReactElement {
    const dispatch = useAppDispatch()
    const activeTab = useAppSelector((state) => state.ui.activeTab)
    const selectedSkill = useAppSelector((state) => state.skills.selectedSkill)

    return (
      <aside className="h-full border-l border-border bg-card flex flex-col overflow-hidden">
        <div className="h-8 drag-region shrink-0 flex items-center justify-end pr-2">
          {activeTab !== 'marketplace' && selectedSkill && (
            <button
              type="button"
              onClick={() => dispatch(selectSkill(null))}
              className="no-drag min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close detail panel"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {activeTab === 'marketplace' ? (
          <MarketplaceDetailPanel />
        ) : selectedSkill ? (
          <SkillDetail skill={selectedSkill} />
        ) : (
          <DashboardCanvas />
        )}
      </aside>
    )
  },
)
