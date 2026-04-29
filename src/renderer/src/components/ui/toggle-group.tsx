import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '../../lib/utils'

/**
 * Variant + size styles shared by every `ToggleGroupItem`. Mirrors the shadcn
 * `toggle` cva so future imports of standalone `<Toggle>` (if added later)
 * stay visually aligned. Inlined here because the project currently has no
 * standalone toggle usage; adding `toggle.tsx` purely as a re-export would
 * be dead code.
 *
 * Tuning notes:
 * - Default size is `h-11` (44px) so it clears the Apple HIG / WCAG 2.2 AA
 *   tap-target floor without callers having to remember to bump `size`. The
 *   `sm` variant intentionally stays at 32px — it's a "compact" opt-in for
 *   inspector toolbars where the user has explicitly chosen density.
 * - Focus ring is `ring-2 ring-offset-2`. Single-pixel rings disappear into
 *   the input border on `outline` variants when the theme preset has low
 *   chroma (neutral-light); the offset gives the ring its own breathing room
 *   regardless of preset.
 * - `outline` variant adds `data-[state=on]:border-primary` so the active
 *   item has a clear color anchor on neutral presets where `bg-accent`
 *   collapses to a near-background gray. The border is a 1px swap (not a
 *   width change) so there is no layout shift when toggling.
 */
const toggleVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground data-[state=on]:border-primary',
      },
      size: {
        default: 'h-11 px-3 min-w-11',
        sm: 'h-8 px-1.5 min-w-8',
        lg: 'h-12 px-3.5 min-w-12',
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
  const context = React.useContext(ToggleGroupContext)
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
