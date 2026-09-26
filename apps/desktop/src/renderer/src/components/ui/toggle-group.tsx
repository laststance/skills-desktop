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
 * Renders one styled Radix option after ToggleGroup injects any missing group-level styles.
 * @param props - Radix item props plus optional per-item variant, size, and ref.
 * @returns One accessible toggle option button.
 * @example
 * <ToggleGroupItem value="name">Name</ToggleGroupItem>
 */
const ToggleGroupItem = function ToggleGroupItem({
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
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant,
          size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

type ToggleGroupStyleProps = VariantProps<typeof toggleVariants>

/**
 * Apply group styles only to direct ToggleGroupItem children so wrappers and text remain untouched.
 * @param children - Root children supplied to ToggleGroup.
 * @param variant - Group variant used when an item has no override.
 * @param size - Group size used when an item has no override.
 * @returns Children with missing direct-item styles filled from the group.
 * @example
 * injectToggleGroupDefaults(<ToggleGroupItem value="name" />, 'outline', 'sm')
 */
export const injectToggleGroupDefaults = function injectToggleGroupDefaults(
  children: React.ReactNode,
  variant: ToggleGroupStyleProps['variant'],
  size: ToggleGroupStyleProps['size'],
): React.ReactNode {
  return React.Children.map(children, (child): React.ReactNode => {
    // Only direct ToggleGroupItem children receive defaults; text and wrappers pass through unchanged.
    if (
      !React.isValidElement<ToggleGroupStyleProps>(child) ||
      child.type !== ToggleGroupItem
    ) {
      return child
    }

    return React.cloneElement(child, {
      variant: child.props.variant ?? variant,
      size: child.props.size ?? size,
    })
  })
}

/**
 * Composes a Radix group and injects shared styles into its direct ToggleGroupItem children.
 * @param props - Radix root props plus group-level variant, size, children, and ref.
 * @returns One toggle group whose item-level overrides take precedence.
 * @example
 * <ToggleGroup type="single" value={scope} onValueChange={(value) => value && setScope(value)}>
 *   <ToggleGroupItem value="name">Name</ToggleGroupItem>
 *   <ToggleGroupItem value="repo">Repo</ToggleGroupItem>
 * </ToggleGroup>
 */
const ToggleGroup = function ToggleGroup({
  className,
  variant,
  size,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & { ref?: React.Ref<HTMLDivElement> }) {
  const styledChildren = injectToggleGroupDefaults(children, variant, size)

  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cn('flex items-center justify-center gap-1', className)}
      {...props}
    >
      {styledChildren}
    </ToggleGroupPrimitive.Root>
  )
}

export { ToggleGroup, ToggleGroupItem, toggleVariants }
