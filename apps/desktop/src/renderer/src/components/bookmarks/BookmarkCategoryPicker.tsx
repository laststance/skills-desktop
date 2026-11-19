import { Check, Pencil, Plus, Tag } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { useUnmountEffect } from '@/renderer/src/hooks/useUnmountEffect'
import { cn } from '@/renderer/src/lib/utils'
import type { BookmarkCategory } from '@/renderer/src/redux/bookmarkCategories'
import {
  useAppDispatch,
  useAppSelector,
  useAppStore,
} from '@/renderer/src/redux/hooks'
import {
  assignBookmarkCategory,
  selectBookmarkCategories,
  selectCategoryForSkill,
} from '@/renderer/src/redux/slices/bookmarkSlice'
import {
  closeBookmarkCategoryEditor,
  openBookmarkCategoryEditor,
} from '@/renderer/src/redux/slices/uiSlice'
import type { SkillName } from '@/shared/types'

import { BookmarkCategoryEditor } from './BookmarkCategoryEditor'
import { categoryAppearance } from './categoryAppearance'

interface PickerProps {
  skillName: SkillName
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  onChangeBookmark?: (change: () => void) => void
}

/** The same picker edits an Installed card or an open bookmark detail; saving a new card can open it immediately.
 * @example <BookmarkCategoryPicker skillName={name} open={open} onOpenChange={setOpen} />
 */
export function BookmarkCategoryPicker({
  skillName,
  open,
  onOpenChange,
  className,
  onChangeBookmark,
}: PickerProps) {
  const dispatch = useAppDispatch()
  const categories = useAppSelector(selectBookmarkCategories)
  const current = useAppSelector((state) =>
    selectCategoryForSkill(state, skillName),
  )
  const pickerId = useId()
  const store = useAppStore()
  const editor = useAppSelector((state) => {
    const active = state.ui.bookmarkCategoryEditor
    return active?.pickerId === pickerId ? active : null
  })
  useUnmountEffect(() => {
    // Virtualized cards and nested bookmark details can unmount while their editor is open.
    if (store.getState().ui.bookmarkCategoryEditor?.pickerId === pickerId) {
      dispatch(closeBookmarkCategoryEditor(pickerId))
    }
  })
  const trigger = useRef<HTMLButtonElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const [showFullName, setShowFullName] = useState(false)
  const movingToEditor = useRef(false)
  const title = current?.name ?? 'Set category'
  const apply = (change: () => void): void => {
    if (onChangeBookmark) onChangeBookmark(change)
    else change()
  }
  const choose = (categoryId?: string): void =>
    apply(() =>
      dispatch(assignBookmarkCategory({ name: skillName, categoryId })),
    )
  const edit = (category?: BookmarkCategory): void => {
    movingToEditor.current = true
    dispatch(
      openBookmarkCategoryEditor({
        pickerId,
        categoryId: category?.id ?? null,
      }),
    )
    onOpenChange(false)
  }
  const restore = (event: Event): void => {
    event.preventDefault()
    if (trigger.current?.isConnected) trigger.current.focus()
  }
  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
        <Tooltip
          open={showFullName}
          onOpenChange={(show) =>
            setShowFullName(
              Boolean(
                show &&
                label.current &&
                label.current.scrollWidth > label.current.clientWidth,
              ),
            )
          }
        >
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                ref={trigger}
                title={title}
                aria-label={title}
                data-category-for={skillName}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                className={cn(
                  'inline-flex h-6 min-w-6 max-w-full items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  className,
                )}
              >
                {current ? (
                  <span
                    aria-hidden="true"
                    style={categoryAppearance(current)}
                    className="category-dot"
                  />
                ) : (
                  <Tag aria-hidden="true" className="size-3 shrink-0" />
                )}
                <span ref={label} className="truncate">
                  {title}
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{title}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          aria-labelledby={undefined}
          aria-label={`Category for ${skillName}`}
          className="w-52 max-h-72 overflow-y-auto"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            if (movingToEditor.current) {
              event.preventDefault()
              movingToEditor.current = false
            }
          }}
        >
          <DropdownMenuItem onSelect={() => choose()}>
            <span className="flex-1">Uncategorized</span>
            {!current && <Check className="size-3.5" />}
          </DropdownMenuItem>
          {categories.map((category) => (
            <div key={category.id} className="group/edit flex items-center">
              <DropdownMenuItem
                className="min-w-0 flex-1 gap-2"
                textValue={category.name}
                onSelect={() => choose(category.id)}
              >
                <span
                  aria-hidden="true"
                  className="category-dot"
                  style={categoryAppearance(category)}
                />
                <span className="min-w-0 flex-1 truncate" title={category.name}>
                  {category.name}
                </span>
                {current?.id === category.id && <Check className="size-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Edit ${category.name}`}
                textValue={`Edit ${category.name}`}
                onSelect={() => edit(category)}
                className="size-6 shrink-0 justify-center p-0 opacity-0 group-hover/edit:opacity-100 group-focus-within/edit:opacity-100 data-highlighted:opacity-100"
              >
                <Pencil className="size-3.5" />
              </DropdownMenuItem>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => edit()}>
            <Plus className="mr-2 size-3.5" />
            New category
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editor && (
        <BookmarkCategoryEditor
          skillName={skillName}
          category={categories.find(
            (category) => category.id === editor.categoryId,
          )}
          confirming={editor.confirmingDelete}
          onClose={() => dispatch(closeBookmarkCategoryEditor(pickerId))}
          apply={apply}
          restoreFocus={restore}
        />
      )}
    </>
  )
}
