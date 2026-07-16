import React from 'react'

import { KEYBINDINGS } from '@/shared/constants'

import { SectionFrame } from './SectionFrame'

/**
 * Keybindings pane — read-only list.
 *
 * The list is sourced from the canonical `KEYBINDINGS` constant in
 * `src/shared/constants.ts` so adding or renaming a menu accelerator
 * in `src/main/index.ts` only requires updating one place. Editing
 * shortcuts is intentionally out of scope until users ask — a real
 * editor would need conflict detection, a per-os table for the modifier
 * glyphs, and a way to flush updates to the menu's `accelerator` field.
 */
export const Keybindings = function Keybindings(): React.ReactElement {
  return (
    <SectionFrame
      title="Keybindings"
      description="Keyboard shortcuts wired into the app menu. Read-only for now."
    >
      <div className="rounded-md border border-border bg-card/40">
        <ul className="divide-y divide-border">
          {KEYBINDINGS.map((binding) => (
            <li
              key={binding.id}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
            >
              <span className="text-sm">{binding.action}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {binding.display}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </SectionFrame>
  )
}
