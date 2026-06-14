import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/renderer/src/lib/utils'

/**
 * Variant + size styles shared by every `ToggleGroupItem`. Mirrors the shadcn
 * `toggle` cva so future imports of standalone `<Toggle>` (if added later)
 * stay visually aligned. Inlined here because the project currently has no
 * standalone toggle usage; adding `toggle.tsx` purely as a re-export would
 * be dead code.
 *
 * Tuning notes:
 * - Refined desktop scale parallels `button.tsx`: default `h-8` (32px),
 *   `sm` (28px), `lg` (36px). This is a pointer-driven app, so the visual
 *   height is the hit target — no 44px touch inflation. Glyph-only items
 *   still clear the 24px WCAG 2.5.8 AA floor via `min-w`.
 * - Focus ring is `ring-2 ring-offset-2`. Single-pixel rings disappear into
 *   the input border on `outline` variants when the theme preset has low
 *   chroma (neutral-light); the offset gives the ring its own breathing room
 *   regardless of preset.
 * - `outline` variant keeps unselected hover muted while active items stay
 *   anchored by `data-[state=on]`. This prevents hover from impersonating
 *   selection on segmented controls with adjacent options.
 */
const toggleVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-input bg-transparent shadow-sm hover:bg-muted/70 hover:text-foreground data-[state=off]:hover:bg-muted/70 data-[state=off]:hover:text-foreground data-[state=on]:border-primary data-[state=on]:hover:bg-accent data-[state=on]:hover:text-accent-foreground',
      },
      size: {
        default: 'h-8 px-3 min-w-8',
        sm: 'h-7 px-1.5 min-w-7',
        lg: 'h-9 px-3.5 min-w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/**
 * Context that lets `ToggleGroup` push its `variant` / `size` down to every
 * `ToggleGroupItem` without callers having to repeat the props on each item.
 */
const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: 'default',
  variant: 'default',
})

/**
 * Radix `ToggleGroup.Root` styled to match the shadcn default look.
 * Single-select (`type="single"`) is the common usage; pass `type="multiple"`
 * for checkbox-style toggle sets.
 *
 * @example
 *   <ToggleGroup type="single" value={scope} onValueChange={(v) => v && setScope(v)}>
 *     <ToggleGroupItem value="name">Name</ToggleGroupItem>
 *     <ToggleGroupItem value="repo">Repo</ToggleGroupItem>
 *   </ToggleGroup>
 */
const ToggleGroup = React.memo(function ToggleGroup({
  className,
  variant,
  size,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    ref?: React.Ref<HTMLDivElement>
  }) {
  // Stable identity for the context value so consumers don't re-render every
  // time the parent re-renders with the same variant/size pair. React 19's
  // `<Context>` (no `.Provider`) is the new shorthand.
  const contextValue = React.useMemo(() => ({ variant, size }), [variant, size])
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cn('flex items-center justify-center gap-1', className)}
      {...props}
    >
      <ToggleGroupContext value={contextValue}>{children}</ToggleGroupContext>
    </ToggleGroupPrimitive.Root>
  )
})

/**
 * One option button inside a `ToggleGroup`. Inherits `variant` / `size` from
 * the surrounding group's context unless explicitly overridden.
 */
const ToggleGroupItem = React.memo(function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ref,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants> & {
    ref?: React.Ref<HTMLButtonElement>
  }) {
  const context = React.use(ToggleGroupContext)
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: variant ?? context.variant,
          size: size ?? context.size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})

export { ToggleGroup, ToggleGroupItem, toggleVariants }
