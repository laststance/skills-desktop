import { Check, ImageOff, Trash2 } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import {
  List,
  type ListImperativeAPI,
  type RowComponentProps,
} from 'react-window'

import { BackgroundCredit } from '@/renderer/src/components/background/BackgroundCredit'
import { Button } from '@/renderer/src/components/ui/button'
import { cn } from '@/renderer/src/lib/utils'
import { backgroundSourceKey } from '@/renderer/src/utils/backgroundSourceKey'
import type { BackgroundCatalogItem } from '@/shared/backgrounds'

import {
  GALLERY_OVERSCAN_ROWS,
  GALLERY_ROW_HEIGHT_PX,
  GALLERY_THREE_COLUMN_MIN_WIDTH_PX,
} from './constants'

interface GridProps {
  items: BackgroundCatalogItem[]
  selectedKey: string
  appliedKey: string
  scope: string
  active: boolean
  scrollPositions: Map<string, number>
  onSelect: (item: BackgroundCatalogItem) => void
  onRemove: (item: BackgroundCatalogItem) => void
  onEndReached: () => void
}

/** Virtualizes fixed photo rows while stable IDs prevent delayed focus from stealing a user's next action.
 * @returns One radio selection stop, separate credit/remove targets and a bounded scrolling list.
 * @example <BackgroundPhotoGrid items={items} selectedKey={draftKey} appliedKey={savedKey} {...navigation} />
 */
export function BackgroundPhotoGrid(props: GridProps): ReactElement {
  const {
    columns,
    focusKey,
    list,
    container,
    buttons,
    visibleStart,
    pending,
    frame,
    rowCount,
    navigate,
    cancelFocus,
    focusPending,
    onFocusKey,
    onResize,
  } = useBackgroundGridNavigation(props)

  return (
    <div
      ref={container}
      role="radiogroup"
      aria-label="Background photos"
      tabIndex={props.items.length ? -1 : 0}
      className="min-h-0 flex-1 focus-visible:outline focus-visible:outline-ring"
      onKeyDown={navigate}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          cancelFocus()
      }}
    >
      <List
        listRef={list}
        className="h-full"
        style={{ height: '100%', minHeight: 80 }}
        rowComponent={PhotoRow}
        rowCount={rowCount}
        rowHeight={GALLERY_ROW_HEIGHT_PX}
        overscanCount={GALLERY_OVERSCAN_ROWS}
        rowProps={{
          ...props,
          columns,
          focusKey: buttons.current.has(focusKey)
            ? focusKey
            : props.items[visibleStart.current * columns]
              ? backgroundSourceKey(
                  props.items[visibleStart.current * columns].source,
                )
              : '',
          buttons: buttons.current,
          container,
          onFocusKey,
        }}
        onResize={onResize}
        onScroll={(event) => {
          props.scrollPositions.set(props.scope, event.currentTarget.scrollTop)
        }}
        onRowsRendered={(visible) => {
          visibleStart.current = visible.startIndex
          if (visible.stopIndex >= rowCount - 1 && props.active)
            props.onEndReached()
          if (pending.current) {
            if (frame.current !== null) cancelAnimationFrame(frame.current)
            frame.current = requestAnimationFrame(focusPending)
          }
        }}
      />
    </div>
  )
}

type PhotoRowProps = GridProps & {
  columns: number
  focusKey: string
  buttons: Map<string, HTMLButtonElement>
  container: React.RefObject<HTMLDivElement | null>
  onFocusKey: (key: string) => void
}

/** Renders only the requested row; captions stay opaque and interactive credits never nest inside radios.
 * @returns A reserved-height row of independently labelled photo choices.
 * @example <PhotoRow index={0} style={rowStyle} {...rowProps} />
 */
function PhotoRow({
  index,
  style,
  items,
  columns,
  selectedKey,
  appliedKey,
  focusKey,
  buttons,
  container,
  onFocusKey,
  onSelect,
  onRemove,
}: RowComponentProps<PhotoRowProps>): ReactElement {
  return (
    <div
      style={style}
      role="presentation"
      className="grid gap-3 pb-3 pr-2"
      data-background-photo-row={index}
    >
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {items.slice(index * columns, (index + 1) * columns).map((item) => {
          const key = backgroundSourceKey(item.source)
          return (
            <div key={key} className="min-w-0">
              <button
                ref={(node) => {
                  if (!node) return
                  buttons.set(key, node)
                  return () => {
                    // A manually scrolled-away focused row hands focus to a stable owner before unmount.
                    if (document.activeElement === node)
                      container.current?.focus({ preventScroll: true })
                    buttons.delete(key)
                  }
                }}
                type="button"
                role="radio"
                aria-checked={selectedKey === key}
                aria-label={`${item.title}${appliedKey === key ? ', Applied' : ''}`}
                tabIndex={focusKey === key ? 0 : -1}
                onFocus={() => onFocusKey(key)}
                onClick={() => onSelect(item)}
                className={cn(
                  'relative block h-28 w-full overflow-hidden rounded-md border bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selectedKey === key
                    ? 'border-primary ring-1 ring-primary'
                    : 'border-border',
                )}
              >
                {item.thumbnail ? (
                  <img
                    className="relative h-full w-full bg-muted object-cover"
                    src={item.thumbnail.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                ) : (
                  <ImageOff
                    aria-hidden
                    className="mx-auto h-5 w-5 text-muted-foreground"
                  />
                )}
                {selectedKey === key ? (
                  <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                ) : null}
                {appliedKey === key ? (
                  <span className="opaque-surface absolute bottom-2 left-2 rounded bg-background px-2 py-0.5 text-[11px] text-foreground">
                    Applied
                  </span>
                ) : null}
              </button>
              <div className="opaque-surface mt-1 flex items-center gap-1 bg-background">
                <p
                  className="min-w-0 flex-1 truncate text-xs font-medium"
                  title={item.title}
                >
                  {item.title}
                </p>
                {item.source.kind === 'upload' ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${item.title}`}
                    onClick={() => onRemove(item)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <BackgroundCredit credit={item.credit} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Coordinates virtual focus with row rendering and invalidates stale targets after context changes.
 * @returns Stable DOM references and semantic navigation handlers for {@link BackgroundPhotoGrid}.
 * @example const navigation = useBackgroundGridNavigation(props)
 */
function useBackgroundGridNavigation(props: GridProps) {
  const [columns, setColumns] = useState(3)
  const [focusKey, setFocusKey] = useState(props.selectedKey)
  const list = useRef<ListImperativeAPI | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const visibleStart = useRef(0)
  const pending = useRef<{
    key: string
    owner: Element | null
    scope: string
  } | null>(null)
  const frame = useRef<number | null>(null)
  const scope = `${props.scope}:${columns}:${props.active}`
  const latest = useRef({
    scope,
    items: props.items,
    selectedKey: props.selectedKey,
  })
  latest.current = { scope, items: props.items, selectedKey: props.selectedKey }
  const rowCount = Math.ceil(props.items.length / columns)
  const wasActive = useRef(props.active)

  const cancelFocus = (): void => {
    pending.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }
  useEffect(() => {
    cancelFocus()
    // Returning from Crop restores the saved viewport; no second image-data cache is introduced.
    if (props.active && list.current?.element)
      list.current.element.scrollTop =
        props.scrollPositions.get(props.scope) ?? 0
    if (props.active && !wasActive.current) {
      const index = latest.current.items.findIndex(
        (item) =>
          backgroundSourceKey(item.source) === latest.current.selectedKey,
      )
      if (index >= 0) {
        pending.current = {
          key: latest.current.selectedKey,
          owner: document.activeElement,
          scope,
        }
        list.current?.scrollToRow({
          index: Math.floor(index / columns),
          align: 'auto',
          behavior: 'instant',
        })
        focusPending()
        if (pending.current) frame.current = requestAnimationFrame(focusPending)
      } else
        container.current
          ?.closest('[role="dialog"]')
          ?.querySelector<HTMLElement>('h2')
          ?.focus()
    }
    wasActive.current = props.active
    return cancelFocus
  }, [scope, props.active, props.scope, props.scrollPositions, columns])

  const focusPending = (): void => {
    const target = pending.current
    if (
      !target ||
      target.scope !== latest.current.scope ||
      !latest.current.items.some(
        (item) => backgroundSourceKey(item.source) === target.key,
      )
    ) {
      cancelFocus()
      return
    }
    const owner = document.activeElement
    if (owner !== target.owner && owner !== container.current) {
      cancelFocus()
      return
    }
    const button = buttons.current.get(target.key)
    if (button) {
      pending.current = null
      button.focus()
      setFocusKey(target.key)
    }
  }

  const navigate = (event: KeyboardEvent): void => {
    const direction = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }[event.key]
    if (direction === undefined && event.key !== 'Home' && event.key !== 'End')
      return
    const current = props.items.findIndex(
      (item) => backgroundSourceKey(item.source) === focusKey,
    )
    const start =
      document.activeElement === container.current
        ? visibleStart.current * columns
        : Math.max(0, current)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? props.items.length - 1
          : Math.min(
              props.items.length - 1,
              Math.max(0, start + (direction ?? 0)),
            )
    const next = props.items[nextIndex]
    if (!next || Math.floor(nextIndex / columns) >= rowCount) return
    event.preventDefault()
    cancelFocus()
    const key = backgroundSourceKey(next.source)
    pending.current = { key, owner: document.activeElement, scope }
    list.current?.scrollToRow({
      index: Math.floor(nextIndex / columns),
      align: 'auto',
      behavior: 'instant',
    })
    props.onSelect(next)
    frame.current = requestAnimationFrame(focusPending)
  }

  return {
    columns,
    focusKey,
    list,
    container,
    buttons,
    visibleStart,
    pending,
    frame,
    rowCount,
    navigate,
    cancelFocus,
    focusPending,
    onFocusKey: (key: string): void => setFocusKey(key),
    onResize: ({ width }: { width: number }): void => {
      if (!props.active || width <= 0) return
      cancelFocus()
      setColumns(width >= GALLERY_THREE_COLUMN_MIN_WIDTH_PX ? 3 : 2)
    },
  }
}
