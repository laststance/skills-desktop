import { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectDashboardPages,
  setCurrentPage,
  toggleEditMode,
} from '../../redux/slices/dashboardSlice'

/**
 * Wire global keyboard shortcuts for the dashboard.
 *
 * - ⌘E / Ctrl+E → toggle edit mode.
 * - ⌘1-9 / Ctrl+1-9 → switch to page N (1-indexed; gaps at the end are ignored).
 *
 * The handler no-ops when focus is inside an editable surface (input, textarea,
 * `contenteditable`) so number keys still type into Widget-level inputs (e.g.,
 * the page-rename input) without switching pages. Modifier keys are required
 * so plain digits/letters in app UI aren't captured.
 *
 * @returns void — listener is attached for the lifetime of the calling component.
 * @example
 * export function DashboardCanvas() {
 *   useDashboardKeyboardShortcuts()
 *   // ...
 * }
 */
export function useDashboardKeyboardShortcuts(): void {
  const dispatch = useAppDispatch()
  const pages = useAppSelector(selectDashboardPages)

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent): void {
      // Require Cmd (macOS) or Ctrl (anywhere else) so plain keypresses pass
      // through to whatever surface they're aimed at.
      const hasModifier = keyboardEvent.metaKey || keyboardEvent.ctrlKey
      if (!hasModifier) return

      // Never hijack keys while the user is typing — Widget rename fields,
      // search inputs, etc. all need digits and letters to work normally.
      const eventTarget = keyboardEvent.target as HTMLElement | null
      const isEditableTarget =
        eventTarget instanceof HTMLInputElement ||
        eventTarget instanceof HTMLTextAreaElement ||
        eventTarget?.isContentEditable === true
      if (isEditableTarget) return

      // ⌘E / Ctrl+E — edit mode toggle.
      // Matching case-insensitively so Shift+⌘E still works.
      if (keyboardEvent.key === 'e' || keyboardEvent.key === 'E') {
        keyboardEvent.preventDefault()
        dispatch(toggleEditMode())
        return
      }

      // ⌘1-9 / Ctrl+1-9 — page switch. event.key gives "1".."9" directly.
      if (keyboardEvent.key >= '1' && keyboardEvent.key <= '9') {
        const pageIndex = Number(keyboardEvent.key) - 1
        const targetPage = pages[pageIndex]
        if (targetPage) {
          keyboardEvent.preventDefault()
          dispatch(setCurrentPage(targetPage.id))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return (): void => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, pages])
}
