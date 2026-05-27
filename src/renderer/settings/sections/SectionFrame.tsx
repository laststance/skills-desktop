import React from 'react'

import { Separator } from '@/renderer/src/components/ui/separator'

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
