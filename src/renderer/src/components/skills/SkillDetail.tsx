import { Check, Copy, Unlink2 } from 'lucide-react'
import React, { Activity } from 'react'
import { toast } from 'sonner'

import { SymlinkStatus } from '@/renderer/src/components/status/SymlinkStatus'
import { Button } from '@/renderer/src/components/ui/button'
import { Separator } from '@/renderer/src/components/ui/separator'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { cn } from '@/renderer/src/lib/utils'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import type { LocationViewModel } from '@/renderer/src/utils/getLocationViewModel'
import { getLocationViewModel } from '@/renderer/src/utils/getLocationViewModel'
import type { Settings } from '@/shared/settings'
import type { Skill, SymlinkInfo } from '@/shared/types'

import { CodePreview } from './CodePreview'
import { SourceLink } from './SourceLink'

// Keep copied feedback visible long enough to be noticed without lingering.
const COPIED_FEEDBACK_DURATION_MS = 1600

interface SkillDetailProps {
  skill: Skill
}

/**
 * Detailed view of a selected skill with tabs.
 *
 * The active tab is read from the persisted `settings.defaultSkillTab`
 * (single source of truth, owned by the main process). Tapping a tab
 * dispatches `setSettings` for instant UI feedback and fires a
 * `settings:set` IPC so the choice is durable across sessions and
 * synchronised with the Settings window — both surfaces edit the exact
 * same field. This means "last used tab is the default tab" by design.
 */
export const SkillDetail = React.memo(function SkillDetail({
  skill,
}: SkillDetailProps): React.ReactElement {
  const settings = useAppSelector((state) => state.settings)
  const activeTab = settings.defaultSkillTab
  const { items: agents } = useAppSelector((state) => state.agents)
  const selectedAgentId = useAppSelector((state) => state.ui.selectedAgentId)
  const updateSettings = useUpdateSettings()

  const handleTabChange = (nextTab: Settings['defaultSkillTab']): void => {
    if (nextTab === activeTab) return
    updateSettings({ defaultSkillTab: nextTab })
  }

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
  const inaccessibleCount = filteredSymlinks.filter(
    (s) => s.status === 'inaccessible',
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
          aria-pressed={activeTab === 'files'}
          onClick={() => handleTabChange('files')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'files'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          Files
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'info'}
          onClick={() => handleTabChange('info')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
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
          and Info. See react-rules.md "<Activity> - State Preservation".

          Orphan note: when `skill.isOrphan` is true the source path is a
          dead symlink. CodePreview would `lstat(skill.path)` and surface
          a confusing error, so we swap in OrphanNotice for the Files tab.
          InfoView still works — it shows the broken symlinks per agent,
          which is exactly what the user needs to decide on cleanup. */}
      <div className="flex-1 min-h-0 relative">
        <Activity mode={activeTab === 'files' ? 'visible' : 'hidden'}>
          {skill.isOrphan ? (
            <OrphanNotice />
          ) : (
            <CodePreview skillPath={skill.path} />
          )}
        </Activity>
        <Activity mode={activeTab === 'info' ? 'visible' : 'hidden'}>
          <InfoView
            skill={skill}
            filteredSymlinks={filteredSymlinks}
            validCount={validCount}
            brokenCount={brokenCount}
            inaccessibleCount={inaccessibleCount}
            location={locationView}
          />
        </Activity>
      </div>
    </div>
  )
})

/**
 * Files-tab placeholder shown when `skill.isOrphan` is true. The original
 * `~/.agents/skills/<name>/` directory is gone; only broken symlinks remain
 * in agent dirs. There is nothing to preview, so we explain the state and
 * point the user at the Info tab where the per-agent broken list lives.
 */
const OrphanNotice = React.memo(function OrphanNotice(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <Unlink2 className="size-10 text-amber-400 mb-3" aria-hidden />
      <h3 className="text-sm font-medium text-foreground mb-1">
        Source skill is missing
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs">
        The original skill folder no longer exists. Remaining links in agent
        directories are broken — see the Info tab for which agents are affected.
      </p>
    </div>
  )
})

interface InfoViewProps {
  skill: Skill
  filteredSymlinks: SymlinkInfo[]
  validCount: number
  brokenCount: number
  inaccessibleCount: number
  location: LocationViewModel
}

interface LocationPathClipboardState {
  copiedPath: string | null
  copyPath: (path: string, label: string) => Promise<void>
}

/**
 * Manage clipboard writes and short-lived copied feedback for Location path rows.
 * @returns Copied path state and copy handler for LocationPathRow.
 * @example
 * const { copiedPath, copyPath } = useLocationPathClipboard()
 */
function useLocationPathClipboard(): LocationPathClipboardState {
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)
  const resetCopiedPathTimeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (resetCopiedPathTimeoutRef.current !== null) {
        window.clearTimeout(resetCopiedPathTimeoutRef.current)
      }
    }
  }, [])

  const copyPath = React.useCallback(
    async (path: string, label: string): Promise<void> => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard API unavailable')
        }
        await navigator.clipboard.writeText(path)
        setCopiedPath(path)

        // Reset feedback after a short confirmation window.
        if (resetCopiedPathTimeoutRef.current !== null) {
          window.clearTimeout(resetCopiedPathTimeoutRef.current)
        }
        resetCopiedPathTimeoutRef.current = window.setTimeout(() => {
          setCopiedPath((currentPath) =>
            currentPath === path ? null : currentPath,
          )
          resetCopiedPathTimeoutRef.current = null
        }, COPIED_FEEDBACK_DURATION_MS)
      } catch {
        toast.error(`Failed to copy ${getLocationPathCopyName(label)}`)
      }
    },
    [],
  )

  return { copiedPath, copyPath }
}

const InfoView = React.memo(function InfoView({
  skill,
  filteredSymlinks,
  validCount,
  brokenCount,
  inaccessibleCount,
  location,
}: InfoViewProps): React.ReactElement {
  const { copiedPath, copyPath } = useLocationPathClipboard()

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
        <div>
          <span className="text-muted-foreground">Inaccessible:</span>
          <span className="ml-1 text-amber-400">{inaccessibleCount}</span>
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
            <LocationPathRow
              label="Source Files"
              path={location.sourcePath}
              isCopied={copiedPath === location.sourcePath}
              onCopy={copyPath}
            />
            <LocationPathRow
              label="Symlink"
              path={location.symlinkPath}
              isCopied={copiedPath === location.symlinkPath}
              onCopy={copyPath}
            />
          </div>
        ) : (
          <LocationPathRow
            label="Path"
            path={location.sourcePath}
            isCopied={copiedPath === location.sourcePath}
            onCopy={copyPath}
          />
        )}
      </div>
    </div>
  )
})

interface LocationPathRowProps {
  label: string
  path: string
  isCopied: boolean
  onCopy: (path: string, label: string) => Promise<void>
}

/**
 * Render one copyable path row in the Skill Info Location section.
 * @param label - Short label shown above the path and used in copy feedback.
 * @param path - Absolute filesystem path displayed to the user.
 * @param isCopied - Whether this row is currently showing copied feedback.
 * @param onCopy - Clipboard writer owned by InfoView.
 * @returns A labelled path with a compact Copy/Copied action.
 * @example
 * <LocationPathRow label="Path" path="/Users/me/.agents/skills/foo" isCopied={false} onCopy={copyPath} />
 */
const LocationPathRow = React.memo(function LocationPathRow({
  label,
  path,
  isCopied,
  onCopy,
}: LocationPathRowProps): React.ReactElement {
  const copyName = getLocationPathCopyName(label)
  const handleCopyClick = React.useCallback((): void => {
    void onCopy(path, label)
  }, [label, onCopy, path])

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex items-start gap-2 min-w-0">
        <code className="flex-1 min-w-0 text-xs bg-muted px-2 py-1 rounded break-all">
          {path}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopyClick}
          aria-label={`Copy ${copyName}`}
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {isCopied ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  )
})

/**
 * Build human copy for Location path actions without producing "path path".
 * @param label - Visible row label from the Location section.
 * @returns Lowercase phrase used in aria labels and error toasts.
 * @example
 * getLocationPathCopyName('Path') // => 'path'
 * getLocationPathCopyName('Source Files') // => 'source files path'
 */
function getLocationPathCopyName(label: string): string {
  return label === 'Path' ? 'path' : `${label.toLowerCase()} path`
}
