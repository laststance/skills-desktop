import { Bookmark, Lock, MoreHorizontal } from 'lucide-react'
import type { ReactElement } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '@/renderer/src/redux/slices/bookmarkSlice'
import {
  addProtection,
  removeProtection,
  selectIsProtected,
} from '@/renderer/src/redux/slices/protectSlice'
import {
  selectIsBulkOpBusy,
  setSkillToAddSymlinks,
  setSkillToCopy,
  setSkillToUnlink,
} from '@/renderer/src/redux/slices/skillsSlice'
import { setBulkConfirm } from '@/renderer/src/redux/slices/uiSlice'
import type { Skill, SkillName } from '@/shared/types'

import { canBookmarkSkill, skillToBookmarkData } from './bookmarkHelpers'
import { partitionGlobalDeleteTargets } from './reviewedDestructiveTargets'
import { getSkillItemVisibility } from './skillItemHelpers'

/** Root-only actions use the same eligibility and reviewed destructive targets as List cards.
 * Shift+F10 and the visible overflow button share this menu; descendants never instantiate it.
 * @example <SkillTreeActions skill={skill} open={open} onOpenChange={setOpen} retry={retry} />
 */
export function SkillTreeActions({
  skill,
  open,
  onOpenChange,
  retry,
  ambiguous,
}: {
  skill: Skill
  open: boolean
  onOpenChange: (open: boolean) => void
  retry: (() => void) | null
  ambiguous: boolean
}): ReactElement {
  const dispatch = useAppDispatch()
  const agentId = useAppSelector((state) => state.ui.selectedAgentId)
  const locked = useAppSelector((state) => selectIsProtected(state, skill.name))
  const bookmarked = useAppSelector((state) =>
    selectIsBookmarked(state, skill.name),
  )
  const busy = useAppSelector(selectIsBulkOpBusy)
  const visibility = getSkillItemVisibility(agentId, skill)
  const remove = (): void => {
    if (busy || locked || ambiguous) return
    const targets = partitionGlobalDeleteTargets(
      [skill],
      [skill.name],
      new Set<SkillName>(),
    )
    dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'row',
        skillNames: [skill.name],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...targets,
      }),
    )
  }
  return (
    <div
      className="ml-auto flex shrink-0 items-center gap-0.5"
      onClick={(event) => event.stopPropagation()}
    >
      {locked && (
        <Lock aria-label="Locked" className="size-3 text-muted-foreground" />
      )}
      {bookmarked && (
        <Bookmark aria-label="Bookmarked" className="size-3 text-primary" />
      )}
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Actions for ${skill.name}`}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.querySelector<HTMLElement>('[role="tree"]')?.focus()
          }}
        >
          {retry && (
            <DropdownMenuItem onSelect={retry}>
              Retry loading files
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={ambiguous}
            onSelect={() =>
              dispatch(
                locked
                  ? removeProtection(skill.name)
                  : addProtection({
                      name: skill.name,
                      identity: skill.filesystemIdentity,
                    }),
              )
            }
          >
            {locked ? 'Unlock' : 'Lock'}
          </DropdownMenuItem>
          {canBookmarkSkill(skill) && (
            <DropdownMenuItem
              disabled={ambiguous}
              onSelect={() =>
                dispatch(
                  bookmarked
                    ? removeBookmark(skill.name)
                    : addBookmark({
                        name: skill.name,
                        ...skillToBookmarkData(skill),
                      }),
                )
              }
            >
              {bookmarked ? 'Remove bookmark' : 'Bookmark'}
            </DropdownMenuItem>
          )}
          {visibility.showCopyButton && (
            <DropdownMenuItem
              disabled={busy || ambiguous}
              onSelect={() => dispatch(setSkillToCopy(skill))}
            >
              Copy to…
            </DropdownMenuItem>
          )}
          {visibility.showAddButton && (
            <DropdownMenuItem
              disabled={busy || ambiguous}
              onSelect={() =>
                dispatch(
                  agentId
                    ? setSkillToCopy(skill)
                    : setSkillToAddSymlinks(skill),
                )
              }
            >
              Add to agents…
            </DropdownMenuItem>
          )}
          {visibility.showUnlinkButton && (
            <DropdownMenuItem
              disabled={busy || locked || ambiguous}
              onSelect={() => {
                const symlink =
                  visibility.selectedAgentSymlink ??
                  visibility.selectedLocalSkillInfo
                if (symlink && !locked && !busy)
                  dispatch(setSkillToUnlink({ skill, symlink }))
              }}
            >
              Unlink…
            </DropdownMenuItem>
          )}
          {visibility.showDeleteButton && (
            <DropdownMenuItem
              disabled={busy || locked || ambiguous}
              onSelect={remove}
            >
              Delete…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
