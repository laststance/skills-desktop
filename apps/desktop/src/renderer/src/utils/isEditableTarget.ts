/**
 * True when the given DOM target is a text-editable surface — native inputs,
 * textareas, `contenteditable`, or ARIA `role="textbox"`. Used by global
 * keyboard listeners (Cmd+A, Esc, ⌘E, ⌘1-9, ...) to stand down while the
 * user is typing so their keystrokes reach the focused input.
 *
 * Accepts `EventTarget | null` so it works with both `event.target` (inside a
 * handler) and `document.activeElement` (checked from anywhere).
 *
 * @param target - The DOM target to test — usually `event.target` or `document.activeElement`
 * @returns True when the target is an editable surface; false for null or non-editable elements
 * @example
 * // Inside a keydown listener:
 * if (isEditableTarget(event.target)) return
 *
 * // From outside a handler:
 * if (isEditableTarget(document.activeElement)) return
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return true
    if (target.getAttribute('role') === 'textbox') return true
  }
  return false
}
