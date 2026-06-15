import type { LucideIcon } from 'lucide-react'
import * as React from 'react'

import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import { cn } from '@/renderer/src/lib/utils'

/**
 * One selectable segment in a {@link SegmentedControl}.
 *
 * @property value - Discriminant returned to `onValueChange` when this segment is picked.
 * @property label - Visible content (string or node), rendered after any `icon`.
 * @property icon - Optional leading lucide glyph; rendered decorative (`aria-hidden`).
 * @property ariaLabel - Accessible name when `label` alone is ambiguous (e.g. icon-only or terse text).
 * @property disabled - Disables only this segment (e.g. a currently-unavailable choice).
 */
export interface SegmentedControlOption<TValue extends string> {
  value: TValue
  label: React.ReactNode
  icon?: LucideIcon
  ariaLabel?: string
  disabled?: boolean
}

/**
 * Props for {@link SegmentedControl}. Generic over the option-value union so
 * `value`, `onValueChange`, and every `options[].value` stay in lockstep.
 *
 * @property options - The segments to render, in display order (2, 3, 4+ supported).
 * @property value - Currently-selected segment value.
 * @property onValueChange - Fired with the newly-selected value; never fired for a deselect.
 * @property aria-label - Accessible name for the group as a whole (required for a11y).
 * @property size - Item height preset; `default` (32px) or `sm` (28px) for dense rows.
 * @property fullWidth - Stretch segments edge-to-edge (`w-full` + `flex-1`); default content-sized + left-aligned.
 * @property disabled - Disable the whole control; per-segment disabling uses `option.disabled`.
 * @property itemClassName - Classes applied to every segment (e.g. `h-9` to match an adjacent input).
 */
export interface SegmentedControlProps<TValue extends string> {
  options: ReadonlyArray<SegmentedControlOption<TValue>>
  value: TValue
  onValueChange: (value: TValue) => void
  'aria-label': string
  size?: 'default' | 'sm' | 'lg'
  fullWidth?: boolean
  disabled?: boolean
  className?: string
  itemClassName?: string
}

/**
 * Connected (border-collapsed) single-select segmented control — the "Name/Repo"
 * toggle generalized to N options. Wraps the shared `ToggleGroup` primitive,
 * collapsing inner borders/corners so 2, 3, or 4+ options read as one seamless
 * control, and swallowing Radix's empty-string deselect so exactly one option
 * stays selected. Use for mutually-exclusive setting toggles (DESIGN.md → Tabs
 * and Segmented Controls). Roving-tabindex keyboard nav comes free from Radix.
 *
 * @example
 *   <SegmentedControl
 *     aria-label="Search field"
 *     value={scope}
 *     onValueChange={setScope}
 *     options={[
 *       { value: 'name', label: 'Name' },
 *       { value: 'repo', label: 'Repo' },
 *     ]}
 *   />
 */
// Generic over TValue, so React.memo can't wrap it without erasing the generic
// call signature (it widens TValue to string). This is a thin wrapper whose
// expensive children (ToggleGroup / ToggleGroupItem) are already memoized.
// eslint-disable-next-line @laststance/react-next/all-memo -- memo erases the generic signature
export function SegmentedControl<TValue extends string>({
  options,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  size = 'default',
  fullWidth = false,
  disabled = false,
  className,
  itemClassName,
}: SegmentedControlProps<TValue>): React.ReactElement {
  // Radix emits "" when the active segment is re-clicked. Matching the emitted
  // value back to an option swallows that deselect (one option always stays
  // active) and narrows `next` to TValue without an `as` cast.
  const handleValueChange = React.useCallback(
    (next: string): void => {
      const selected = options.find((option) => option.value === next)
      if (selected) onValueChange(selected.value)
    },
    [options, onValueChange],
  )

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size={size}
      value={value}
      onValueChange={handleValueChange}
      aria-label={ariaLabel}
      disabled={disabled}
      // gap-0 + per-item border collapse = one seamless control. Left-align when
      // content-sized (DESIGN.md: secondary toggles stay compact, left-anchored).
      className={cn('gap-0', fullWidth ? 'w-full' : 'justify-start', className)}
    >
      {options.map((option, index) => {
        const isFirst = index === 0
        const isLast = index === options.length - 1
        const Icon = option.icon
        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            className={cn(
              // Collapse the border + corners shared with the previous segment.
              !isFirst && 'rounded-l-none border-l-0',
              !isLast && 'rounded-r-none',
              // Raise the focused segment so its ring isn't clipped by neighbors.
              'focus:z-10 focus-visible:z-10',
              fullWidth && 'flex-1',
              itemClassName,
            )}
          >
            {Icon ? <Icon aria-hidden /> : null}
            {option.label}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
