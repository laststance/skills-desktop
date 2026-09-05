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
import { useDeleteHiddenAgents } from '@/renderer/src/hooks/useDeleteHiddenAgents'
import { getHiddenAgentsDeleteNotices } from '@/renderer/src/utils/getHiddenAgentsDeleteNotices'
import { getHiddenAgentsLabel } from '@/renderer/src/utils/getHiddenAgentsLabel'
import type { Agent } from '@/shared/types'

/**
 * Adds the hidden-section overflow menu and a reviewed bulk folder-deletion dialog for AgentsSection.
 * @param props - Installed agents hidden by the user's sidebar settings.
 * @returns The menu trigger and confirmation dialog, kept mounted across rescans.
 * @example <HiddenAgentsMenu agents={hiddenInstalled} />
 */
export function HiddenAgentsMenu({
  agents,
  focusFallbackRef,
}: {
  agents: Agent[]
  focusFallbackRef?: React.RefObject<HTMLElement | null>
}): React.ReactElement {
  const deletion = useDeleteHiddenAgents(agents)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmedRef = useRef(false)
  const hiddenAgentsLabel = getHiddenAgentsLabel(agents.length)
  const notices = getHiddenAgentsDeleteNotices(
    deletion.review?.skippedCount ?? 0,
    deletion.protectedCount,
  )

  return (
    <>
      {hiddenAgentsLabel && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 size-6 text-muted-foreground hover:text-foreground"
              aria-label="Hidden agent actions"
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
                  : 'No separate skills folders can be deleted'
              }
            >
              <Trash2 aria-hidden="true" />
              Delete skills folders...
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
        title="Delete hidden agents’ skills folders?"
        description={
          <div className="space-y-3">
            {notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
            <p>
              Move these {deletion.review?.agents.length} skills folders and
              their contents to Trash. Folders containing protected skills will
              remain.
            </p>
            <ul
              aria-label="Skills folders to delete"
              className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3"
            >
              {deletion.review?.agents.map((agent) => (
                <li key={agent.id}>
                  <span className="block text-foreground">{agent.name}</span>
                  <span className="block break-all font-mono text-xs">
                    {agent.path}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              Shared source skills and visible agents are kept. You can restore
              deleted folders from Trash.
            </p>
          </div>
        }
        confirmLabel="Delete folders"
        loadingLabel="Deleting folders..."
      />
    </>
  )
}
