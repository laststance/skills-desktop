import React, { Activity, useState } from 'react'

import type { Skill, SymlinkInfo } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppSelector } from '../../redux/hooks'
import type { LocationViewModel } from '../../utils/getLocationViewModel'
import { getLocationViewModel } from '../../utils/getLocationViewModel'
import { SymlinkStatus } from '../status/SymlinkStatus'
import { Separator } from '../ui/separator'

import { CodePreview } from './CodePreview'
import { SourceLink } from './SourceLink'

interface SkillDetailProps {
  skill: Skill
}

type TabType = 'info' | 'code'

/**
 * Detailed view of a selected skill with tabs
 */
export const SkillDetail = React.memo(function SkillDetail({
  skill,
}: SkillDetailProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabType>('code')
  const { items: agents } = useAppSelector((state) => state.agents)
  const selectedAgentId = useAppSelector((state) => state.ui.selectedAgentId)

  // Filter symlinks to only show detected agents (exists: true)
  const detectedAgentIds = new Set(
    agents.filter((a) => a.exists).map((a) => a.id),
  )
  const filteredSymlinks = skill.symlinks.filter((s) =>
    detectedAgentIds.has(s.agentId),
  )

  const locationView = getLocationViewModel(skill, selectedAgentId)

  const validCount = filteredSymlinks.filter((s) => s.status === 'valid').length
  const brokenCount = filteredSymlinks.filter(
    (s) => s.status === 'broken',
  ).length

  return (
    <div className="flex flex-col h-full">
      {/* Header with skill name */}
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold truncate">{skill.name}</h2>
        {skill.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {skill.description}
          </p>
        )}
      </div>

      {/* Tab buttons */}
      <div className="flex border-b border-border">
        <button
          type="button"
          aria-pressed={activeTab === 'code'}
          onClick={() => setActiveTab('code')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors',
            activeTab === 'code'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          Files
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'info'}
          onClick={() => setActiveTab('info')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors',
            activeTab === 'info'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          Info
        </button>
      </div>

      {/* Tab content: both branches stay mounted so their state — scroll
          position, selected file tab — survives toggling between Files
          and Info. See react-rules.md "<Activity> - State Preservation". */}
      <div className="flex-1 min-h-0 relative">
        <Activity mode={activeTab === 'code' ? 'visible' : 'hidden'}>
          <CodePreview skillPath={skill.path} />
        </Activity>
        <Activity mode={activeTab === 'info' ? 'visible' : 'hidden'}>
          <InfoView
            skill={skill}
            filteredSymlinks={filteredSymlinks}
            validCount={validCount}
            brokenCount={brokenCount}
            location={locationView}
          />
        </Activity>
      </div>
    </div>
  )
})

interface InfoViewProps {
  skill: Skill
  filteredSymlinks: SymlinkInfo[]
  validCount: number
  brokenCount: number
  location: LocationViewModel
}

const InfoView = React.memo(function InfoView({
  skill,
  filteredSymlinks,
  validCount,
  brokenCount,
  location,
}: InfoViewProps): React.ReactElement {
  return (
    <div className="p-4 overflow-auto h-full">
      <SourceLink source={skill.source} sourceUrl={skill.sourceUrl} />

      <div className="flex gap-4 text-sm mb-4">
        <div>
          <span className="text-muted-foreground">Valid:</span>
          <span className="ml-1 text-success">{validCount}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Broken:</span>
          <span className="ml-1 text-amber-400">{brokenCount}</span>
        </div>
      </div>

      <Separator className="my-4" />

      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Symlink Status
        </h3>
        <div className="space-y-2">
          {filteredSymlinks.map((symlink) => (
            <SymlinkStatus key={symlink.agentId} symlink={symlink} />
          ))}
        </div>
      </div>

      <Separator className="my-4" />

      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Location
        </h3>
        {location.symlinkPath ? (
          <div className="space-y-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Source Files
              </div>
              <code className="text-xs bg-muted px-2 py-1 rounded break-all inline-block max-w-full">
                {location.sourcePath}
              </code>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Symlink</div>
              <code className="text-xs bg-muted px-2 py-1 rounded break-all inline-block max-w-full">
                {location.symlinkPath}
              </code>
            </div>
          </div>
        ) : (
          <code className="text-xs bg-muted px-2 py-1 rounded break-all inline-block max-w-full">
            {location.sourcePath}
          </code>
        )}
      </div>
    </div>
  )
})
