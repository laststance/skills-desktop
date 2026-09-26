import { isEditableTarget } from './isEditableTarget'
import { isInspectorFocused } from './isInspectorFocused'

/**
 * Hands the keyboard to the Installed list after a press that could not move
 * focus itself: the agent-view "Copy to…" menu trigger and the card's ⇧
 * text-selection guard both cancel a press's default. Without this the search
 * box or the Inspector keeps Esc and ⌘A, so the list's clear and select-all
 * shortcuts miss. {@link SkillItem} calls it from its card and row-checkbox
 * clicks. A focused list control, and a text selection inside the list, stay.
 * @returns void
 * @example
 * searchInput.focus()
 * releaseKeyboardToList()
 * document.activeElement // => document.body
 */
export function releaseKeyboardToList(): void {
  const focusedElement = document.activeElement
  // Only the surfaces that claim Esc and ⌘A give up focus.
  if (
    focusedElement instanceof HTMLElement &&
    (isEditableTarget(focusedElement) ||
      isInspectorFocused(focusedElement, null))
  ) {
    focusedElement.blur()
  }
  // With the body focused, a caret or selection left in the Inspector still
  // claims ⌘A. A plain press would have moved it into the card.
  const textSelection = document.getSelection()
  if (
    isInspectorFocused(
      document.activeElement,
      textSelection?.anchorNode ?? null,
    )
  ) {
    textSelection?.removeAllRanges()
  }
}
