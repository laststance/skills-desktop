import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addPage,
  removePage,
  renamePage,
  selectCurrentPageId,
  selectDashboardPages,
  selectIsEditMode,
  setCurrentPage,
} from '../../redux/slices/dashboardSlice'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

import type { DashboardPage, DashboardPageId } from './types'

/**
 * Page tab bar — horizontal row of buttons, one per dashboard page.
 *
 * Visibility rules:
 *   - View mode, single page: bar is hidden (no tabs, nothing to switch).
 *   - View mode, multi-page: bar shows tabs only.
 *   - Edit mode: bar always shows — even with one page — because it hosts
 *     the "+" trailing button for adding new pages.
 *
 * Uses `role="tablist"` / `role="tab"` for screen readers (Apple HIG a11y).
 */
export const DashboardPageTabs = React.memo(
  function DashboardPageTabs(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const pages = useAppSelector(selectDashboardPages)
    const currentPageId = useAppSelector(selectCurrentPageId)
    const isEditMode = useAppSelector(selectIsEditMode)
    const [renamingPageId, setRenamingPageId] =
      useState<DashboardPageId | null>(null)

    // Ref to the tablist container — used to move focus to the newly-active
    // tab after arrow-key navigation changes the store.
    const tablistRef = useRef<HTMLDivElement>(null)

    // Single page + view mode: nothing meaningful to render.
    if (pages.length <= 1 && !isEditMode) return null

    const handleAddPage = (): void => {
      dispatch(addPage())
    }

    // WAI-ARIA Authoring Practices — tablist keyboard navigation.
    // ArrowLeft/Right cycle (wrap at ends); Home/End jump to first/last.
    // Rename mode owns its own input's keys, so we bail out when any tab is
    // in rename mode.
    const handleTablistKeyDown = (
      keyboardEvent: React.KeyboardEvent<HTMLDivElement>,
    ): void => {
      if (renamingPageId !== null) return
      if (pages.length === 0) return

      const currentIndex = pages.findIndex((page) => page.id === currentPageId)
      let nextIndex = -1
      switch (keyboardEvent.key) {
        case 'ArrowLeft':
          nextIndex = currentIndex > 0 ? currentIndex - 1 : pages.length - 1
          break
        case 'ArrowRight':
          nextIndex = currentIndex < pages.length - 1 ? currentIndex + 1 : 0
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = pages.length - 1
          break
        default:
          return
      }
      keyboardEvent.preventDefault()
      const nextPage = pages[nextIndex]
      if (!nextPage) return
      dispatch(setCurrentPage(nextPage.id))
      // Defer focus until React rerenders with the new aria-selected state,
      // so screen readers announce the newly-selected tab correctly.
      requestAnimationFrame(() => {
        const tabButtons =
          tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
        tabButtons?.[nextIndex]?.focus()
      })
    }

    return (
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Dashboard pages"
        onKeyDown={handleTablistKeyDown}
        className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-border shrink-0 overflow-x-auto"
      >
        {pages.map((page) => (
          <PageTab
            key={page.id}
            page={page}
            isActive={page.id === currentPageId}
            isEditMode={isEditMode}
            isRenaming={renamingPageId === page.id}
            canDelete={pages.length > 1}
            onSelect={() => dispatch(setCurrentPage(page.id))}
            onStartRename={() => setRenamingPageId(page.id)}
            onFinishRename={() => setRenamingPageId(null)}
          />
        ))}
        {isEditMode && (
          <button
            type="button"
            onClick={handleAddPage}
            aria-label="Add page"
            title="Add page"
            className="
              min-h-[44px] min-w-[44px] inline-flex items-center justify-center
              rounded-md text-muted-foreground hover:text-foreground hover:bg-accent
              transition-colors focus-visible:outline-none
              focus-visible:ring-2 focus-visible:ring-ring
            "
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  },
)

// ----------------------------------------------------------------------------
// PageTab — a single tab. Three visual states:
//   - View mode: plain button that selects the page.
//   - Edit mode: button + overflow dropdown (Rename / Delete).
//   - Renaming: inline input (commit on blur/Enter, cancel on Escape).
// Split into its own component so per-tab state (draft name, focus) doesn't
// re-render the whole bar on every keystroke.
// ----------------------------------------------------------------------------

interface PageTabProps {
  page: DashboardPage
  isActive: boolean
  isEditMode: boolean
  isRenaming: boolean
  canDelete: boolean
  onSelect: () => void
  onStartRename: () => void
  onFinishRename: () => void
}

const PageTab = React.memo(function PageTab({
  page,
  isActive,
  isEditMode,
  isRenaming,
  canDelete,
  onSelect,
  onStartRename,
  onFinishRename,
}: PageTabProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [draftName, setDraftName] = useState(page.name)

  // Reset the draft to the latest canonical name each time rename mode opens.
  // Using rAF defers focus until after the input is mounted in the DOM.
  useEffect(() => {
    if (isRenaming) {
      setDraftName(page.name)
      requestAnimationFrame(() => renameInputRef.current?.select())
    }
  }, [isRenaming, page.name])

  const commitRename = (): void => {
    const trimmedName = draftName.trim()
    if (trimmedName.length > 0 && trimmedName !== page.name) {
      dispatch(renamePage({ pageId: page.id, name: trimmedName }))
    }
    onFinishRename()
  }

  const cancelRename = (): void => {
    onFinishRename()
  }

  const handleDelete = (): void => {
    // The reducer already protects the last page, but the trigger is hidden
    // in that case anyway — keep the guard for defensive symmetry.
    if (!canDelete) return
    const userConfirmed = window.confirm(
      `Delete page "${page.name}"? All widgets on this page will be removed.`,
    )
    if (userConfirmed) {
      dispatch(removePage(page.id))
    }
  }

  if (isRenaming) {
    return (
      <input
        ref={renameInputRef}
        type="text"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitRename()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelRename()
          }
        }}
        aria-label={`Rename page ${page.name}`}
        className="
          min-h-[44px] min-w-[120px] px-3 text-xs font-medium
          rounded-md bg-background border border-input
          outline-none focus:ring-2 focus:ring-ring
        "
      />
    )
  }

  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={onSelect}
        className={cn(
          'min-h-[44px] px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
      >
        {page.name}
      </button>
      {isEditMode && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${page.name}`}
              className="
                min-h-[44px] min-w-[28px] ml-0.5 inline-flex items-center justify-center
                rounded-md text-muted-foreground hover:text-foreground hover:bg-accent
                transition-colors focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-ring
              "
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartRename}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
})
