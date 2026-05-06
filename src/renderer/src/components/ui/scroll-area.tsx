import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'

import { cn } from '@/renderer/src/lib/utils'

/**
 * shadcn-style wrapper around Radix `ScrollArea`.
 *
 * The `[&>div]:!block` modifier on `Viewport` overrides Radix's internal
 * `<div style="min-width: 100%; display: table">` wrapper so its `display`
 * becomes `block` instead of `table`. Radix uses `display: table` to enable
 * horizontal scrolling when content exceeds the viewport width — but in
 * combination with nowrap descendants (e.g. `truncate`, `whitespace-nowrap`)
 * the table grows to its `min-content` width, defeating truncation and
 * pushing the layout wider than the viewport. The Sidebar visualised this
 * as a 325px-wide inner box inside a 272px aside, with the long
 * `~/.agents/skills` path refusing to truncate.
 *
 * `display: block` makes the wrapper take exactly the viewport width, which
 * lets `truncate` actually clip and prevents intrinsic-width inflation. The
 * `!` modifier (compiled to `!important`) is required because Radix sets
 * `display` via an inline style — inline styles outrank class-based rules
 * without it. We never need horizontal scrolling on either current usage
 * (Sidebar lists, SyncResultDialog item rows), so giving up horizontal
 * scroll is intentional, not a regression.
 */
const ScrollArea = React.memo(function ScrollArea({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit] [&>div]:!block">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
})

const ScrollBar = React.memo(function ScrollBar({
  className,
  orientation = 'vertical',
  ref,
  ...props
}: React.ComponentPropsWithRef<
  typeof ScrollAreaPrimitive.ScrollAreaScrollbar
>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent p-[1px]',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent p-[1px]',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
})

export { ScrollArea, ScrollBar }
