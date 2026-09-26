/** DetailPanel marks its root `<aside>` with this attribute. */
const INSPECTOR_PANE_SELECTOR = '[data-inspector-pane]'

/**
 * True when the user is working in the Inspector pane. Its element holds focus,
 * or, with focus on the page body, the text caret or selection sits inside it.
 * The Installed tab's ⌘A shortcut calls it, so the Inspector's readable file
 * text keeps native select-all instead of ticking list rows.
 * @param activeElement - `document.activeElement` when the key was pressed.
 * @param selectionAnchor - `document.getSelection()?.anchorNode`, the caret or selection start.
 * @returns
 * - true when the focused element is inside the Inspector
 * - true when only the body is focused and the caret or selection is inside the Inspector
 * - false otherwise, including when nothing is focused and there is no caret
 * @example
 * isInspectorFocused(document.body, fileTextNode) // => true
 * isInspectorFocused(masterCheckbox, fileTextNode) // => false
 */
export function isInspectorFocused(
  activeElement: Element | null,
  selectionAnchor: Node | null,
): boolean {
  // A focused control decides on its own; the caret only counts with the body focused.
  if (
    activeElement !== null &&
    activeElement !== activeElement.ownerDocument.body
  ) {
    return activeElement.closest(INSPECTOR_PANE_SELECTOR) !== null
  }
  // A text node has no `closest`, so measure from its parent element.
  const anchorElement =
    selectionAnchor instanceof Element
      ? selectionAnchor
      : (selectionAnchor?.parentElement ?? null)
  return Boolean(anchorElement?.closest(INSPECTOR_PANE_SELECTOR))
}
