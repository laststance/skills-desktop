import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useRef, useState } from 'react'
import { match } from 'ts-pattern'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  addPage,
  removePage,
  renamePage,
  selectCurrentPageId,
  selectDashboardPages,
  selectIsEditMode,
  setCurrentPage,
} from '@/renderer/src/redux/slices/dashboardSlice'

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

    const handleAddPage = (): void => {
      dispatch(addPage())
    }

    const handleSelectPage = useCallback(
      (pageId: DashboardPageId): void => {
        dispatch(setCurrentPage(pageId))
      },
      [dispatch],
    )

    const handleStartRename = useCallback((pageId: DashboardPageId): void => {
      setRenamingPageId(pageId)
    }, [])

    const handleFinishRename = useCallback((): void => {
      setRenamingPageId(null)
    }, [])

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
      // -1 signals "no navigation for this key" — falls through to the early
      // return below so unrelated keys don't swallow default browser behavior.
      const nextIndex = match(keyboardEvent.key)
        .with('ArrowLeft', () =>
          currentIndex > 0 ? currentIndex - 1 : pages.length - 1,
        )
        .with('ArrowRight', () =>
          currentIndex < pages.length - 1 ? currentIndex + 1 : 0,
        )
        .with('Home', () => 0)
        .with('End', () => pages.length - 1)
        .otherwise(() => -1)
      if (nextIndex === -1) return
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

    // Single page + view mode: nothing meaningful to render.
    if (pages.length <= 1 && !isEditMode) return null

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
            onSelect={handleSelectPage}
            onStartRename={handleStartRename}
            onFinishRename={handleFinishRename}
          />
        ))}
        {isEditMode && (
          <button
            type="button"
            onClick={handleAddPage}
            aria-label="Add page"
            title="Add page"
            className="
              min-h-7 min-w-7 inline-flex items-center justify-center
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
  onSelect: (pageId: DashboardPageId) => void
  onStartRename: (pageId: DashboardPageId) => void
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
  useCycleEffect(() => {
    if (isRenaming) {
      setDraftName(page.name)
      requestAnimationFrame(() => renameInputRef.current?.select())
    }
  }, [isRenaming, page.name])

  const handleSelect = (): void => {
    onSelect(page.id)
  }

  const handleStartRename = useCallback((): void => {
    onStartRename(page.id)
  }, [onStartRename, page.id])

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

  const handleDelete = useCallback((): void => {
    // The reducer already protects the last page, but the trigger is hidden
    // in that case anyway — keep the guard for defensive symmetry.
    if (!canDelete) return
    const userConfirmed = window.confirm(
      `Delete page "${page.name}"? All widgets on this page will be removed.`,
    )
    if (userConfirmed) {
      dispatch(removePage(page.id))
    }
  }, [canDelete, dispatch, page.id, page.name])

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
          min-h-8 min-w-30 px-3 text-xs font-medium
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
        onClick={handleSelect}
        className={cn(
          'min-h-8 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
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
                min-h-7 min-w-7 ml-0.5 inline-flex items-center justify-center
                rounded-md text-muted-foreground hover:text-foreground hover:bg-accent
                transition-colors focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-ring
              "
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleStartRename}>
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
