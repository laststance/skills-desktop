import { useState } from 'react'

import type { Skill } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppSelector } from '../../redux/hooks'
import { SymlinkStatus } from '../status/SymlinkStatus'
import { Separator } from '../ui/separator'

import { CodePreview } from './CodePreview'

interface SkillDetailProps {
  skill: Skill
}

type TabType = 'info' | 'code'

/**
 * Detailed view of a selected skill with tabs
 */
export function SkillDetail({ skill }: SkillDetailProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabType>('code')
  const { items: agents } = useAppSelector((state) => state.agents)

  // Filter symlinks to only show detected agents (exists: true)
  const detectedAgentIds = new Set(
    agents.filter((a) => a.exists).map((a) => a.id),
  )
  const filteredSymlinks = skill.symlinks.filter((s) =>
    detectedAgentIds.has(s.agentId),
  )

  const validCount = filteredSymlinks.filter((s) => s.status === 'valid').length
  const brokenCount = filteredSymlinks.filter(
    (s) => s.status === 'broken',
  ).length

  return (
    <div className="flex flex-col h-full">
      {/* Header with skill name */}
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold">{skill.name}</h2>
        {skill.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {skill.description}
          </p>
        )}
      </div>

      {/* Tab buttons */}
      <div className="flex border-b border-border">
        <button
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

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'code' ? (
          <CodePreview skillPath={skill.path} />
        ) : (
          <div className="p-4 overflow-auto h-full">
            <div className="flex gap-4 text-sm mb-4">
              <div>
                <span className="text-muted-foreground">Valid:</span>
                <span className="ml-1 text-cyan-400">{validCount}</span>
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
              <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                {skill.path}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
