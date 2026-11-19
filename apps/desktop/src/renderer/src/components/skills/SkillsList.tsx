import { SearchX } from 'lucide-react'
import React, { useLayoutEffect, useRef } from 'react'
import {
  List,
  type RowComponentProps,
  type ListImperativeAPI,
} from 'react-window'

import { Button } from '@/renderer/src/components/ui/button'
import { useInitialEffect } from '@/renderer/src/hooks/useInitialEffect'
import {
  useAppDispatch,
  useAppSelector,
  useAppStore,
} from '@/renderer/src/redux/hooks'
import { selectFilteredSkills } from '@/renderer/src/redux/selectors'
import {
  fetchSkills,
  selectSkillsError,
  selectSkillsItems,
  selectSkillsLoading,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  selectExcludedSkillTypeFilters,
  selectSearchQuery,
  selectSelectedAgentId,
  selectSelectedSources,
  selectSkillTypeFilter,
  setSearchQuery,
} from '@/renderer/src/redux/slices/uiSlice'
import type { Skill, SkillName } from '@/shared/types'
import { toSearchQuery } from '@/shared/types'

import { ALL_CATEGORIES } from '../../redux/bookmarkCategories'
import { EmptyCategoryFilter } from '../bookmarks/BookmarkCategoryFilter'

import { SkillItem } from './SkillItem'
import { getEmptyListMessage } from './skillsListHelpers'

/** Base height: padding (32) + title (24) + source link (20) + source-link mb-2 (8) + row gap pb-3 (12) + border (2) + font metrics (3) */
const ROW_HEIGHT_BASE = 101
/** Extra height for description (line-clamp-2, text-sm: ~40px + mt-1: 4px) */
const ROW_HEIGHT_DESCRIPTION = 44
/** Extra height for status badges row (pt-3: 12px + badge: 22px) */
const ROW_HEIGHT_BADGES = 34

/** Props passed to SkillRow via rowProps */
interface SkillRowProps {
  data: Skill[]
  onFilteredBookmarkEdit: (name: SkillName, change: () => void) => void
}

/**
 * Virtual row component for react-window v2.
 * Receives `index` and `style` from List, plus `data` via rowProps.
 * @param props - RowComponentProps with skill data array
 * @returns Rendered skill item wrapped in positioned div
 * @example
 * <List rowComponent={SkillRow} rowProps={{ data: skills }} ... />
 */
function SkillRow({
  index,
  style,
  data,
  onFilteredBookmarkEdit,
}: RowComponentProps<SkillRowProps>): React.ReactElement {
  return (
    <div style={style}>
      <div className="pb-3 pr-[5px]">
        <SkillItem
          skill={data[index]}
          onFilteredBookmarkEdit={onFilteredBookmarkEdit}
        />
      </div>
    </div>
  )
}

/**
 * Keys each virtual row by its skill, so row state (the failure flash, an open
 * context menu) stays with that skill when a refresh or filter shifts the rows.
 * react-window keys rows by index otherwise. Module-level so the List gets the
 * stable function it requires.
 * @param index - Row index in the filtered list
 * @param rowProps - The List's rowProps, carrying the visible skills
 * @returns The row's skill name
 * @example
 * getSkillRowKey(0, { data: [taskSkill] }) // => 'task'
 */
function getSkillRowKey(index: number, { data }: SkillRowProps): Skill['name'] {
  return data[index].name
}

/**
 * List of all skills with search, agent filtering, and virtual scrolling.
 * Uses react-window v2 for O(visible) DOM nodes instead of O(n).
 */
export const SkillsList = function SkillsList({
  children,
}: {
  children?: React.ReactNode
}): React.ReactElement {
  const dispatch = useAppDispatch()
  const skills = useAppSelector(selectSkillsItems)
  const loading = useAppSelector(selectSkillsLoading)
  const error = useAppSelector(selectSkillsError)
  const selectedAgentId = useAppSelector(selectSelectedAgentId)
  const skillTypeFilter = useAppSelector(selectSkillTypeFilter)
  const searchQuery = useAppSelector(selectSearchQuery)
  const selectedSources = useAppSelector(selectSelectedSources)
  const excludedSkillTypeFilters = useAppSelector(
    selectExcludedSkillTypeFilters,
  )
  const filteredSkills = useAppSelector(selectFilteredSkills)
  const filter = useAppSelector((state) => state.ui.installedCategoryFilter)
  const store = useAppStore()
  const list = useRef<ListImperativeAPI | null>(null)
  const pendingFocus = useRef<SkillName | null | undefined>(undefined)

  // Remember the pre-edit order. Only relocate focus if this edit actually removes the row.
  function editBookmark(name: SkillName, change: () => void): void {
    change()
    if (filter === ALL_CATEGORIES) return
    const remaining = new Set(
      selectFilteredSkills(store.getState()).map((skill) => skill.name),
    )
    if (remaining.has(name)) return
    const index = filteredSkills.findIndex((skill) => skill.name === name)
    const next =
      filteredSkills
        .slice(index + 1)
        .find((skill) => remaining.has(skill.name)) ??
      filteredSkills
        .slice(0, index)
        .reverse()
        .find((skill) => remaining.has(skill.name))
    pendingFocus.current = next?.name ?? null
  }
  function focusRenderedCard(): void {
    const name = pendingFocus.current
    if (name === undefined) return
    const button =
      name === null
        ? document.getElementById('installed-bookmark-category-filter')
        : list.current?.element?.querySelector<HTMLButtonElement>(
            `[data-category-for="${CSS.escape(name)}"]`,
          )
    if (button) {
      button.focus()
      pendingFocus.current = undefined
    }
  }
  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (target === undefined) return
    const index = filteredSkills.findIndex((skill) => skill.name === target)
    if (index >= 0) list.current?.scrollToRow({ index, align: 'auto' })
    const frame = requestAnimationFrame(focusRenderedCard)
    return (): void => cancelAnimationFrame(frame)
  }, [filteredSkills])

  useInitialEffect(() => {
    dispatch(fetchSkills())
  })

  /** Resets the search query to empty; fired by the "Clear search" CTA in the search-miss empty state. */
  const handleClearSearch = (): void => {
    dispatch(setSearchQuery(toSearchQuery('')))
  }

  /**
   * Compute row height from skill data without DOM measurement.
   * @param index - Row index in filteredSkills
   * @returns Height in px, accounting for description and status badges
   */
  const getRowHeight = (index: number): number => {
    const skill = filteredSkills[index]
    let height = ROW_HEIGHT_BASE
    if (skill?.description) height += ROW_HEIGHT_DESCRIPTION
    if (!selectedAgentId) height += ROW_HEIGHT_BADGES
    return height
  }

  const rowProps = {
    data: filteredSkills,
    onFilteredBookmarkEdit: editBookmark,
  }
  const listStyle = {
    width: '100%',
    height: '100%',
    scrollbarGutter: 'stable',
  }

  if (loading && skills.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading skills...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-destructive">{error}</div>
      </div>
    )
  }

  if (filteredSkills.length === 0 && filter !== ALL_CATEGORIES)
    return <EmptyCategoryFilter surface="installed" />

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium mb-2">No skills installed</p>
        <p className="text-sm text-muted-foreground mb-4">
          Install your first skill to get started
        </p>
        <code className="px-3 py-2 bg-muted rounded-md text-sm font-mono">
          npx skills add &lt;skill-name&gt;
        </code>
      </div>
    )
  }

  if (filteredSkills.length === 0 && searchQuery.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <SearchX
          className="h-8 w-8 text-muted-foreground/40"
          aria-hidden="true"
        />

        <p className="text-sm text-muted-foreground">
          No skills match &ldquo;{searchQuery}&rdquo;
        </p>
        <Button variant="ghost" size="sm" onClick={handleClearSearch}>
          Clear search
        </Button>
      </div>
    )
  }

  if (filteredSkills.length === 0) {
    const emptyMessage = getEmptyListMessage({
      searchQuery,
      selectedSources,
      selectedAgentId,
      skillTypeFilter,
      excludedSkillTypeFilters,
    })
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">{emptyMessage}</div>
      </div>
    )
  }

  if (children) return <>{children}</>

  return (
    <List<SkillRowProps>
      className="skills-list-scrollbar"
      listRef={list}
      onRowsRendered={focusRenderedCard}
      rowComponent={SkillRow}
      rowCount={filteredSkills.length}
      rowHeight={getRowHeight}
      rowKey={getSkillRowKey}
      rowProps={rowProps}
      overscanCount={5}
      style={listStyle}
    />
  )
}
