/**
 * True when the target is the skills search box (`<input type="search">`). Used
 * by the Installed-tab bulk-select keydown handler so Cmd/Ctrl+A can select all
 * *filtered* rows even while the search box keeps focus — the handler blurs the
 * box first, then selects. Deliberately narrower than `isEditableTarget` (which
 * stands down for ALL text surfaces): here we want to ACT on the search box,
 * while still leaving native Cmd+A intact for other editable fields.
 *
 * A type predicate so callers can `.blur()` the narrowed `HTMLInputElement`
 * without an `as` cast. Accepts `EventTarget | null` to pair with both
 * `event.target` and `document.activeElement`.
 *
 * @param target - The DOM target to test — usually `document.activeElement`
 * @returns True when the target is an `<input type="search">`; false otherwise
 * @example
 * // Inside the bulk-select keydown handler:
 * if (isSelectAllChord && isSearchInput(document.activeElement)) {
 *   document.activeElement.blur() // narrowed to HTMLInputElement
 *   dispatch(selectAll(visibleNames))
 * }
 */
export function isSearchInput(
  target: EventTarget | null,
): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === 'search'
}
