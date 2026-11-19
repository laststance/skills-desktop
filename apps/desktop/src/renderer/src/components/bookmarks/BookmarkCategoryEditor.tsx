import { Check } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { Input } from '@/renderer/src/components/ui/input'
import {
  categoryNameError,
  type BookmarkCategory,
} from '@/renderer/src/redux/bookmarkCategories'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  deleteBookmarkCategory,
  saveBookmarkCategory,
  selectBookmarkCategories,
  selectBookmarkItems,
} from '@/renderer/src/redux/slices/bookmarkSlice'
import { COLOR_PRESET_NAMES, THEME_PRESETS } from '@/shared/constants'
import type { SkillName } from '@/shared/types'

interface EditorProps {
  skillName: SkillName
  category?: BookmarkCategory
  onClose: () => void
  apply: (change: () => void) => void
  restoreFocus: (event: Event) => void
}

/** Edit a draft privately until Apply, and confirm deletion only when assignments would be cleared.
 * @example <BookmarkCategoryEditor skillName={name} category={category} onClose={close} apply={apply} restoreFocus={restore} />
 */
export function BookmarkCategoryEditor({
  skillName,
  category,
  onClose,
  apply,
  restoreFocus,
}: EditorProps) {
  const dispatch = useAppDispatch()
  const categories = useAppSelector(selectBookmarkCategories)
  const usage = useAppSelector((state) =>
    category
      ? selectBookmarkItems(state).filter(
          (item) => item.categoryId === category.id,
        ).length
      : 0,
  )
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? 'blue')
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const field = useId()
  function save(event: React.FormEvent): void {
    event.preventDefault()
    const invalid = categoryNameError(name, categories, category?.id)
    if (invalid) {
      setError(invalid)
      return
    }
    apply(() =>
      dispatch(
        saveBookmarkCategory({
          category: { id: category?.id ?? crypto.randomUUID(), name, color },
          createFor: category ? undefined : skillName,
        }),
      ),
    )
    onClose()
  }
  function remove(): void {
    if (!category) return
    if (usage && !confirming) {
      setConfirming(true)
      return
    }
    apply(() => dispatch(deleteBookmarkCategory(category.id)))
    onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="max-w-sm"
        onCloseAutoFocus={restoreFocus}
        // React also bubbles portaled editor keys through the agent card's menu trigger.
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>
            {confirming
              ? 'Delete category?'
              : category
                ? 'Edit category'
                : 'New category'}
          </DialogTitle>
          <DialogDescription className={confirming ? '' : 'sr-only'}>
            {confirming
              ? `Deleting ${category?.name} makes ${usage} ${usage === 1 ? 'bookmark' : 'bookmarks'} uncategorized. Your bookmarks will stay saved.`
              : 'Choose a category name and color.'}
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove}>
              Delete category
            </Button>
          </DialogFooter>
        ) : (
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-1">
              <label htmlFor={field} className="text-sm font-medium">
                Name
              </label>
              <Input
                id={field}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(undefined)
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? field + '-error' : undefined}
                autoComplete="off"
              />
              {error && (
                <p
                  id={field + '-error'}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Color</legend>
              <div className="grid grid-cols-6 gap-1">
                {COLOR_PRESET_NAMES.map((key) => (
                  <label
                    key={key}
                    title={THEME_PRESETS[key].label}
                    className="relative flex h-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring"
                  >
                    <input
                      type="radio"
                      name={field + '-color'}
                      value={key}
                      aria-label={THEME_PRESETS[key].label}
                      className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                      checked={color === key}
                      onChange={() => setColor(key)}
                    />
                    <span
                      className="flex size-5 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: `oklch(0.65 0.16 ${THEME_PRESETS[key].hue})`,
                      }}
                    >
                      {color === key && (
                        <Check
                          className="size-3 text-black"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <DialogFooter>
              {category && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={remove}
                  className="mr-auto text-destructive"
                >
                  Delete category
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
