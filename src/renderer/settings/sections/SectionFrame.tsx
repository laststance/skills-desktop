import React from 'react'

import { Separator } from '@/renderer/src/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'

interface SectionFrameProps {
  title: string
  description?: string
  children: React.ReactNode
}

/**
 * Shared chrome around each Settings pane: title, optional one-line
 * description, separator, and a vertical-rhythm wrapper for the rows.
 *
 * Lifting this avoids 5× duplication of header markup and means future
 * design tweaks (heading scale, separator spacing, max-width) happen in
 * one place. Kept inside `sections/` because it only exists to serve
 * pane content — exposing it from `components/ui` would invite reuse in
 * places where the sizing is wrong.
 */
export const SectionFrame = React.memo(function SectionFrame({
  title,
  description,
  children,
}: SectionFrameProps): React.ReactElement {
  return (
    <section className="max-w-2xl">
      <header className="mb-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </header>
      <Separator className="my-4" />
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  )
})

interface SectionRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

/**
 * One labeled control row inside a SectionFrame.
 *
 * Layout: stacked label/description on the left, control on the right.
 * Stack instead of side-by-side because Settings sections often have
 * long descriptions that would force the control off-screen on the
 * 800px-wide window. Vertical rhythm reads like Inkdrop / Linear / VS
 * Code's Settings UI.
 */
export const SectionRow = React.memo(function SectionRow({
  label,
  description,
  children,
}: SectionRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
})

interface MockControlProps {
  children: React.ReactNode
}

/**
 * Wraps a disabled control + its label with a "Coming in a future
 * release" tooltip. Used by the Appearance / Auto Updates panes to
 * communicate that the controls are visual stubs.
 *
 * Why a wrapper, not the control itself: Radix Tooltip's
 * `TooltipTrigger asChild` forwards events to its child, but a
 * disabled `<button>` / `<input>` does not fire pointer events. The
 * tooltip would silently not show. Wrapping in a focusable `<div>`
 * captures hover/focus so the tooltip works while the inner control
 * stays unambiguously disabled (50% opacity, cursor-not-allowed).
 */
export const MockControl = React.memo(function MockControl({
  children,
}: MockControlProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          aria-disabled="true"
          className="inline-flex w-fit cursor-not-allowed items-center gap-3 rounded-md opacity-60"
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">Coming in a future release</TooltipContent>
    </Tooltip>
  )
})
