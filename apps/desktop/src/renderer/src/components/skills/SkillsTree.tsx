import { useFileTree, useFileTreeSelector } from '@pierre/trees/react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react'
import {
  List,
  type ListImperativeAPI,
  type RowComponentProps,
} from 'react-window'

import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import { useSkillFilesCache } from '@/renderer/src/hooks/SkillFilesProvider'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectBulkSelectableVisibleSkillNames,
  selectFilteredSkills,
  selectSelectedSkillNamesSet,
} from '@/renderer/src/redux/selectors'
import { selectIsProtected } from '@/renderer/src/redux/slices/protectSlice'
import {
  fetchSkills,
  inspectSkillFile,
  selectIsBulkOpBusy,
  selectRange,
  selectSkill,
  toggleSelection,
} from '@/renderer/src/redux/slices/skillsSlice'
import type { AbsolutePath, Skill } from '@/shared/types'

import { computeRangeSelection } from './bulkDeleteHelpers'
import {
  getBulkIneligibilityReason,
  getSkillItemVisibility,
} from './skillItemHelpers'
import { SkillTreeActions } from './SkillTreeActions'
import {
  buildSkillTree,
  skillTreeFileId,
  type SkillTreeNode,
} from './skillTreeModel'

type TreeModel = ReturnType<typeof useFileTree>['model']
type TreeRow = ReturnType<TreeModel['getVisibleRows']>[number]
interface TreeRowProps {
  rows: readonly TreeRow[]
  nodes: ReadonlyMap<string, SkillTreeNode>
  idPrefix: string
  selectedPath: AbsolutePath | undefined
  currentFile: AbsolutePath | undefined
  checked: ReadonlySet<string>
  eligible: ReadonlySet<string>
  ambiguous: ReadonlySet<string>
  busy: boolean
  menu: string | null
  setMenu: (path: string | null) => void
  activate: (
    path: string,
    event?: Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>,
  ) => void
  toggle: (path: string) => void
  check: (skill: Skill, shift: boolean) => void
  retry: (skill: Skill) => void
  canRetry: (skill: Skill) => boolean
}

/** Renders app-owned rows from Pierre's public model, with separate inspection, checkbox and focus states.
 * @example <List rowComponent={SkillTreeRow} rowHeight={(index) => rows[index].level === 0 ? 44 : 36} />
 */
function SkillTreeRow({
  index,
  style,
  rows,
  nodes,
  idPrefix,
  selectedPath,
  currentFile,
  checked,
  eligible,
  ambiguous,
  busy,
  menu,
  setMenu,
  activate,
  toggle,
  check,
  retry,
  canRetry,
}: RowComponentProps<TreeRowProps>): ReactElement {
  const row = rows[index]
  const node = nodes.get(row.path)
  if (!node) return <div style={style} />
  const root = node.kind === 'root'
  const inspected = root && selectedPath === node.skill.path
  const current = node.kind === 'file' && currentFile === node.file.path
  return (
    <div
      style={style}
      role="treeitem"
      id={`${idPrefix}-${encodeURIComponent(row.path)}`}
      aria-level={row.level + 1}
      aria-posinset={row.posInSet + 1}
      aria-setsize={row.setSize}
      aria-expanded={row.kind === 'directory' ? row.isExpanded : undefined}
      aria-selected={inspected || current}
      aria-checked={root ? checked.has(node.skill.name) : undefined}
      aria-label={node.label}
      data-tree-kind={node.kind}
      data-focused={row.isFocused || undefined}
      className={cn(
        'group flex min-w-0 items-center gap-1 overflow-hidden rounded-sm pr-1 text-[13px] hover:bg-accent/60',
        inspected && 'bg-primary/10 border-l-2 border-primary',
        root && checked.has(node.skill.name) && 'bg-accent',
        current && 'text-foreground bg-primary/10',
        row.isFocused && 'tree-row-focused',
      )}
      onClick={(event) => activate(row.path, event)}
      onContextMenu={(event) => {
        if (root) {
          event.preventDefault()
          setMenu(row.path)
        }
      }}
    >
      <span className="flex w-7 shrink-0 items-center justify-center">
        {root && (
          <TreeSelectionCheckbox
            skill={node.skill}
            checked={checked}
            eligible={eligible}
            ambiguous={ambiguous}
            busy={busy}
            check={check}
          />
        )}
      </span>
      <span className="shrink-0" style={{ width: row.level * 12 }} />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${row.isExpanded ? 'Collapse' : 'Expand'} ${node.label}`}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent',
          row.kind !== 'directory' && 'invisible',
        )}
        onClick={(event) => {
          event.stopPropagation()
          toggle(row.path)
        }}
      >
        <ChevronRight
          className={cn('size-3.5', row.isExpanded && 'rotate-90')}
        />
      </button>
      <TreeRowLabel node={node} expanded={row.isExpanded} />
      {root && (
        <SkillTreeActions
          skill={node.skill}
          open={menu === row.path}
          onOpenChange={(open) => setMenu(open ? row.path : null)}
          retry={canRetry(node.skill) ? (): void => retry(node.skill) : null}
          ambiguous={ambiguous.has(node.skill.name)}
        />
      )}
    </div>
  )
}

/** Virtualized Installed hierarchy. Pierre owns hierarchy/focus; Redux owns domain navigation and bulk selection.
 * @example <SkillsTree collapseToken={0} onExpandedChange={setExpanded} />
 */
export function SkillsTree({
  collapseToken,
  onExpandedChange,
}: {
  collapseToken: number
  onExpandedChange: (expanded: boolean) => void
}): ReactElement {
  const dispatch = useAppDispatch()
  const skills = useAppSelector(selectFilteredSkills)
  const allSkills = useAppSelector((state) => state.skills.items)
  const selected = useAppSelector((state) => state.skills.selectedSkill)
  const intent = useAppSelector((state) => state.skills.inspectedFile)
  const generation = useAppSelector((state) => state.skills.filesGeneration)
  const scanning = useAppSelector((state) => state.skills.loading)
  const anchor = useAppSelector((state) => state.skills.selectionAnchor)
  const eligibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
  const checked = useAppSelector(selectSelectedSkillNamesSet)
  const busy = useAppSelector(selectIsBulkOpBusy)
  const { cache, snapshot } = useSkillFilesCache()
  const ids = useRef(new Map<string, string>())
  for (const skill of skills)
    if (!ids.current.has(skill.path))
      ids.current.set(skill.path, `r${ids.current.size}/`)
  const rootOrder = useRef(new Map<string, number>())
  rootOrder.current = new Map(
    skills.map((skill, index) => [
      ids.current.get(skill.path)!.slice(0, -1),
      index,
    ]),
  )
  const input = useMemo(
    () => buildSkillTree(skills, ids.current, snapshot.entries),
    [skills, snapshot],
  )
  const { model } = useFileTree({
    paths: input.paths,
    initialExpansion: 'closed',
    flattenEmptyDirectories: false,
    sort: (a, b) => {
      // Pierre sorts the complete path input, so ancestors must precede descendants.
      const length = Math.min(a.segments.length, b.segments.length)
      for (let index = 0; index < length; index += 1) {
        const left = a.segments[index]
        const right = b.segments[index]
        if (left === right) continue
        if (index === 0)
          return (
            (rootOrder.current.get(left) ?? 0) -
            (rootOrder.current.get(right) ?? 0)
          )
        if (left === 'SKILL.md') return -1
        if (right === 'SKILL.md') return 1
        return decodeURIComponent(left).localeCompare(decodeURIComponent(right))
      }
      return a.segments.length - b.segments.length
    },
  })
  const rows = useFileTreeSelector(
    model,
    (tree) => tree.getVisibleRows(0, tree.getVisibleCount() - 1),
    (previous, next) =>
      previous.length === next.length &&
      previous.every((row, index) => {
        const other = next[index]
        return (
          row.path === other.path &&
          row.isFocused === other.isFocused &&
          row.isExpanded === other.isExpanded &&
          row.hasChildren === other.hasChildren &&
          row.level === other.level &&
          row.posInSet === other.posInSet &&
          row.setSize === other.setSize
        )
      }),
  )
  const focused = useFileTreeSelector(model, (tree) => tree.getFocusedPath())
  const list = useRef<ListImperativeAPI | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const idPrefix = useId()
  const [menu, setOpenMenu] = useState<string | null>(null)
  const setMenu = (path: string | null): void => {
    if (path) model.focusPath(path)
    setOpenMenu(path)
  }
  const reveal = useRef(0)
  const firstEntry = useRef(true)
  const currentSelection = useRef({
    root: selected?.path,
    file: intent?.path,
    generation,
  })
  currentSelection.current = {
    root: selected?.path,
    file: intent?.path,
    generation,
  }
  const eligible = new Set<string>(eligibleNames)
  const ambiguous = useMemo(() => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const skill of allSkills) {
      if (seen.has(skill.name)) duplicates.add(skill.name)
      seen.add(skill.name)
    }
    return duplicates
  }, [allSkills])

  useCycleEffect(() => {
    const expanded = [...input.nodes.keys()].filter((path) => {
      const item = model.getItem(path)
      return item && 'expand' in item && item.isExpanded()
    })
    model.resetPaths(input.paths, { initialExpandedPaths: expanded })
    model.focusNearestPath(focused)
  }, [model, input])
  useCycleEffect(() => {
    const expanded = new Set<AbsolutePath>()
    for (const skill of skills) {
      const item = model.getItem(ids.current.get(skill.path)!)
      if (item && 'expand' in item && item.isExpanded()) {
        expanded.add(skill.path)
        if (!scanning && !snapshot.entries.has(skill.path))
          void cache.ensure(skill.path)
      }
    }
    cache.pin(expanded)
    onExpandedChange(expanded.size > 0)
  }, [
    cache,
    model,
    rows,
    selected?.path,
    skills,
    onExpandedChange,
    snapshot,
    scanning,
  ])
  useCycleEffect(() => {
    if (collapseToken === 0) return
    reveal.current += 1
    for (const skill of skills) {
      const item = model.getItem(ids.current.get(skill.path)!)
      if (item && 'expand' in item) item.collapse()
    }
  }, [collapseToken, model])
  useCycleEffect(() => {
    if (
      !firstEntry.current ||
      !selected ||
      !skills.some((skill) => skill.path === selected.path)
    )
      return
    const token = ++reveal.current
    const captured = currentSelection.current
    const openingRoot = model.getItem(ids.current.get(selected.path)!)
    if (openingRoot && 'expand' in openingRoot) openingRoot.expand()
    void cache.ensure(selected.path).then((result) => {
      if (
        token !== reveal.current ||
        currentSelection.current.root !== captured.root ||
        currentSelection.current.file !== captured.file ||
        currentSelection.current.generation !== captured.generation
      )
        return
      firstEntry.current = false
      const root = ids.current.get(selected.path)!
      // Publish loaded paths before opening ancestors; a late load never restores keyboard focus.
      const next = buildSkillTree(skills, ids.current, cache.entries)
      model.resetPaths(next.paths)
      const file =
        result.files.find((candidate) => candidate.path === captured.file) ??
        (!captured.file ? result.files[0] : undefined)
      const target = file ? skillTreeFileId(root, file) : root
      let parent = ''
      for (const segment of target.split('/').slice(0, -1)) {
        parent += `${segment}/`
        const item = model.getItem(parent)
        if (item && 'expand' in item) item.expand()
      }
      const index = model
        .getVisibleRows(0, model.getVisibleCount() - 1)
        .findIndex((row) => row.path === target)
      if (index >= 0)
        requestAnimationFrame(() =>
          list.current?.scrollToRow({ index, align: 'auto' }),
        )
    })
    return (): void => {
      reveal.current += 1
    }
  }, [cache, model])
  useCycleEffect(() => {
    const index = rows.findIndex((row) => row.path === focused)
    if (index >= 0) list.current?.scrollToRow({ index, align: 'auto' })
  }, [focused, rows])

  const check = (skill: Skill, shift: boolean): void => {
    if (busy || ambiguous.has(skill.name)) return
    model.focusPath(ids.current.get(skill.path)!)
    container.current?.focus()
    if (shift && anchor)
      dispatch(
        selectRange(
          computeRangeSelection(
            anchor,
            skill.name,
            skills.map((item) => item.name),
            new Set(eligibleNames),
          ),
        ),
      )
    else if (eligible.has(skill.name) || checked.has(skill.name))
      dispatch(toggleSelection(skill.name))
  }
  const toggle = (path: string): void => {
    const item = model.getItem(path)
    if (!item || !('expand' in item)) return
    model.focusPath(path)
    container.current?.focus()
    item.toggle()
    const node = input.nodes.get(path)
    if (item.isExpanded() && node?.kind === 'root')
      void cache.ensure(node.skill.path)
  }
  const retry = (skill: Skill): void => {
    const code = cache.entries.get(skill.path)?.result?.code
    if (code === 'missing') void dispatch(fetchSkills())
    else void cache.ensure(skill.path, true)
  }
  const canRetry = (skill: Skill): boolean => {
    const entry = snapshot.entries.get(skill.path)
    return (
      !entry?.pending &&
      Boolean(
        entry?.result &&
        entry.result.status !== 'complete' &&
        entry.result.code !== 'limit' &&
        entry.result.code !== 'denied' &&
        (entry.result.status === 'error' ||
          entry.result.issues.some((issue) => issue.code !== 'depth')),
      )
    )
  }
  const activate = (
    path: string,
    event?: Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>,
  ): void => {
    model.focusPath(path)
    container.current?.focus()
    const node = input.nodes.get(path)
    if (!node) return
    if (node.kind === 'root') {
      if (event?.shiftKey || event?.metaKey || event?.ctrlKey)
        check(node.skill, Boolean(event.shiftKey))
      else dispatch(selectSkill(node.skill))
    } else if (node.kind === 'directory') toggle(path)
    else if (node.kind === 'file')
      dispatch(inspectSkillFile({ skill: node.skill, path: node.file.path }))
    else if (canRetry(node.skill)) retry(node.skill)
  }
  const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!isTreeNavigationEvent(event, container.current)) return
    const path = model.getFocusedPath()
    const node = path ? input.nodes.get(path) : undefined
    switch (event.key) {
      case 'ArrowDown':
        model.focusNextItem()
        break
      case 'ArrowUp':
        model.focusPreviousItem()
        break
      case 'Home':
        model.focusFirstItem()
        break
      case 'End':
        model.focusLastItem()
        break
      case 'ArrowRight':
      case 'ArrowLeft':
        moveTreeHorizontally(model, event.key, toggle)
        break
      case 'F10':
        if (!event.shiftKey || node?.kind !== 'root') return
        setMenu(path)
        break
      case ' ':
        if (node?.kind === 'root') {
          check(node.skill, event.shiftKey)
          break
        }
        if (path) activate(path)
        break
      case 'Enter':
        if (path) activate(path)
        break
      default:
        return
    }
    event.preventDefault()
  }
  useCycleEffect(() => (): void => cache.pin(new Set()), [cache])
  const props: TreeRowProps = {
    rows,
    nodes: input.nodes,
    idPrefix,
    selectedPath: selected?.path,
    currentFile:
      intent?.path ??
      (selected
        ? snapshot.entries.get(selected.path)?.result?.files[0]?.path
        : undefined),
    checked,
    eligible,
    ambiguous,
    busy,
    menu,
    setMenu,
    activate,
    toggle,
    check,
    retry,
    canRetry,
  }
  return (
    <div
      ref={container}
      role="tree"
      aria-label="Installed skills"
      aria-multiselectable="true"
      tabIndex={0}
      aria-activedescendant={
        focused ? `${idPrefix}-${encodeURIComponent(focused)}` : undefined
      }
      className="skills-tree h-full min-h-0 outline-none"
      onKeyDown={handleKey}
      onFocus={() => {
        if (!model.getFocusedPath()) model.focusFirstItem()
      }}
    >
      <div role="status" className="sr-only">
        {[...snapshot.entries.values()].some((entry) => Boolean(entry.pending))
          ? 'Loading skill files…'
          : ''}
      </div>
      <List<TreeRowProps>
        listRef={list}
        rowComponent={SkillTreeRow}
        rowCount={rows.length}
        rowHeight={getTreeRowHeight}
        rowKey={getTreeRowKey}
        rowProps={props}
        overscanCount={5}
        role="presentation"
        className="skills-list-scrollbar overflow-x-hidden"
        style={{ height: '100%' }}
      />
    </div>
  )
}

/** Stable virtualizer callbacks keep layout bookkeeping independent of component renders.
 * @example getTreeRowHeight(0, { rows }) // 44
 */
function getTreeRowHeight(index: number, { rows }: TreeRowProps): number {
  return rows[index]?.level === 0 ? 44 : 36
}
/** Keys virtual rows by the public model identity after filtering or expansion.
 * @example getTreeRowKey(0, { rows }) // 'r0/'
 */
function getTreeRowKey(index: number, { rows }: TreeRowProps): string {
  return rows[index].path
}

/** Keeps root-only checkbox eligibility separate from row navigation and file activation.
 * @example <TreeSelectionCheckbox skill={skill} checked={checked} eligible={eligible} ambiguous={ambiguous} busy={false} check={check} />
 */
function TreeSelectionCheckbox({
  skill,
  checked,
  eligible,
  ambiguous,
  busy,
  check,
}: Pick<
  TreeRowProps,
  'checked' | 'eligible' | 'ambiguous' | 'busy' | 'check'
> & { skill: Skill }): ReactElement {
  const agentId = useAppSelector((state) => state.ui.selectedAgentId)
  const locked = useAppSelector((state) => selectIsProtected(state, skill.name))
  const visibility = getSkillItemVisibility(agentId, skill)
  const reason = ambiguous.has(skill.name)
    ? 'Duplicate skill name — review its location before bulk actions'
    : eligible.has(skill.name)
      ? null
      : getBulkIneligibilityReason({
          isProtected: locked,
          isLocalSkill: visibility.isLocalSkill,
          selectedAgentSymlinkStatus:
            visibility.selectedAgentSymlink?.status ?? null,
        })
  return (
    <label
      className="flex size-6 items-center justify-center"
      title={reason ?? undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <Checkbox
        tabIndex={-1}
        aria-label={`Select ${skill.name}`}
        aria-description={reason ?? undefined}
        checked={checked.has(skill.name)}
        disabled={
          busy ||
          ambiguous.has(skill.name) ||
          (!eligible.has(skill.name) && !checked.has(skill.name))
        }
        className="size-4"
        onCheckedChange={() => undefined}
        onClick={(event) => {
          event.stopPropagation()
          check(skill, event.shiftKey)
        }}
      />
    </label>
  )
}

/** Labels root status separately from file identity, retaining ellipsis at narrow panel widths.
 * @example <TreeRowLabel node={node} expanded={false} />
 */
function TreeRowLabel({
  node,
  expanded,
}: {
  node: SkillTreeNode
  expanded: boolean
}): ReactElement {
  const root = node.kind === 'root'
  const Icon =
    root || node.kind === 'directory' ? (expanded ? FolderOpen : Folder) : File
  const status = node.skill.isOrphan
    ? 'Source missing'
    : node.skill.isUnreadable
      ? 'Unreadable'
      : `${node.skill.symlinks.filter((link) => link.status === 'valid').length} linked agents`
  return (
    <>
      <Icon
        aria-hidden
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground',
          node.skill.isOrphan && 'text-amber-400',
        )}
      />
      <div className="min-w-0 flex-1 truncate" title={node.label}>
        <span
          className={cn(
            root && 'font-medium',
            node.kind === 'notice' && 'text-xs text-muted-foreground',
          )}
        >
          {node.label}
        </span>
        {root && (
          <span className="block truncate text-xs text-muted-foreground">
            {status}
          </span>
        )}
      </div>
    </>
  )
}

/** Applies tree-standard horizontal navigation through the public model without inspecting a row.
 * @example moveTreeHorizontally(model, 'ArrowLeft', toggle)
 */
function moveTreeHorizontally(
  model: TreeModel,
  key: 'ArrowLeft' | 'ArrowRight',
  toggle: (path: string) => void,
): void {
  const path = model.getFocusedPath()
  const item = path ? model.getItem(path) : null
  if (key === 'ArrowRight') {
    if (!item || !('expand' in item)) return
    if (item.isExpanded()) model.focusNextItem()
    else toggle(path!)
  } else if (item && 'expand' in item && item.isExpanded()) item.collapse()
  else model.focusParentItem()
}

/** Leaves native shortcuts and menu/input events to their owning surface.
 * @example isTreeNavigationEvent(event, container.current)
 */
function isTreeNavigationEvent(
  event: KeyboardEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
): boolean {
  return (
    event.target === container &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  )
}
