import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/renderer/src/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Filled variants are flat — border + tonal surface, no drop-shadow.
        // Shadow is reserved for floating UI (popovers, dialogs, toasts).
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Refined desktop scale (DESIGN.md Buttons). This is a pointer-driven app,
      // so the visual height IS the hit target — no 44px touch inflation needed.
      size: {
        default: 'h-8 px-3', // 32px — Linear/Raycast density, 13px label from base
        xs: 'h-6 px-2', // 24px — dense chips, inline actions
        sm: 'h-7 px-2.5', // 28px — toolbar / filter buttons
        lg: 'h-9 px-4', // 36px — primary CTAs
        // Standalone icon button. Dense row tools use size-6 (24px WCAG 2.5.8 AA floor).
        icon: 'size-7', // 28px, 16px glyph
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.memo(function Button({
  className,
  variant,
  size,
  asChild = false,
  ref,
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})

export { Button, buttonVariants }
