import { MoreVertical, Trash2 } from 'lucide-react'
import React, { useRef } from 'react'

import { DestructiveConfirmDialog } from '@/renderer/src/components/shared/DestructiveConfirmDialog'
import { Button } from '@/renderer/src/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import { useDeleteAgentFolders } from '@/renderer/src/hooks/useDeleteAgentFolders'
import type { AgentFolderGroup } from '@/renderer/src/redux/slices/uiSlice'
import { getAgentFolderDeleteNotices } from '@/renderer/src/utils/getAgentFolderDeleteNotices'
import type { Agent } from '@/shared/types'

/**
 * Adds a sidebar group's overflow menu and reviewed bulk folder-deletion dialog for AgentsSection.
 * @param props - Group, scanned agents, and stable focus target after cleanup.
 * @returns The menu trigger and confirmation dialog, kept mounted across rescans.
 * @example <AgentFoldersMenu agents={hiddenInstalled} />
 */
export function AgentFoldersMenu({
  agents,
  group = 'hidden',
  focusFallbackRef,
}: {
  agents: Agent[]
  group?: AgentFolderGroup
  focusFallbackRef?: React.RefObject<HTMLElement | null>
}): React.ReactElement {
  const deletion = useDeleteAgentFolders(agents, group)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmedRef = useRef(false)
  const isUnused = group === 'unused'
  const notices = getAgentFolderDeleteNotices(
    deletion.review?.skippedCount ?? 0,
    deletion.protectedCount,
    group,
  )

  return (
    <>
      {agents.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 size-6 text-muted-foreground hover:text-foreground"
              aria-label={
                isUnused
                  ? 'Not installed agent actions'
                  : 'Hidden agent actions'
              }
              disabled={deletion.isDeleting}
            >
              <MoreVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // Let the confirmation receive focus instead of the closing menu trigger.
              if (deletion.review) event.preventDefault()
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                confirmedRef.current = false
                deletion.openReview()
              }}
              disabled={!deletion.canDelete}
              className="text-destructive focus:text-destructive"
              title={
                deletion.canDelete
                  ? undefined
                  : isUnused
                    ? 'No empty agent folders can be deleted'
                    : 'No separate skills folders can be deleted'
              }
            >
              <Trash2 aria-hidden="true" />
              {isUnused
                ? 'Delete empty agent folders...'
                : 'Delete skills folders...'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DestructiveConfirmDialog
        open={Boolean(deletion.review)}
        onClose={deletion.closeReview}
        onConfirm={() => {
          confirmedRef.current = true
          deletion.deleteAction()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // Cleanup can remove the trigger during the rescan; the heading persists.
          const focusTarget = confirmedRef.current
            ? (focusFallbackRef?.current ?? triggerRef.current)
            : (triggerRef.current ?? focusFallbackRef?.current)
          focusTarget?.focus()
        }}
        loading={deletion.isDeleting}
        title={
          isUnused
            ? 'Delete empty agent folders?'
            : 'Delete hidden agents’ skills folders?'
        }
        description={
          <div className="space-y-3">
            {notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
            {isUnused ? (
              <p>
                Move these {deletion.review?.agents.length} empty agent folders
                to Trash. Folders containing files, settings, history, or skills
                will be kept.
              </p>
            ) : (
              <p>
                Move these {deletion.review?.agents.length} skills folders and
                their contents to Trash. Folders containing protected skills
                will remain.
              </p>
            )}
            <ul
              aria-label={
                isUnused
                  ? 'Empty agent folders to delete'
                  : 'Skills folders to delete'
              }
              className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3"
            >
              {deletion.review?.agents.map((agent) => (
                <li key={agent.id}>
                  <span className="block text-foreground">{agent.name}</span>
                  <span className="block break-all font-mono text-xs">
                    {isUnused ? agent.emptyParentFolder?.path : agent.path}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              {isUnused
                ? 'Only empty, separate parent folders are removed. You can restore deleted folders from Trash.'
                : 'Shared source skills and visible agents are kept. You can restore deleted folders from Trash.'}
            </p>
          </div>
        }
        confirmLabel="Delete folders"
        loadingLabel="Deleting folders..."
      />
    </>
  )
}
