import { useRef, useState } from 'react'

import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { useUpdateEffect } from '@/renderer/src/hooks/useUpdateEffect'

interface FocusedOverlayState {
  /** True while the subject is lifted into the focused full-window overlay. */
  isExpanded: boolean
  /** Enter the overlay, remembering the current focus for later restoration. */
  expand: () => void
  /** Leave the overlay and restore focus to the element that triggered it. */
  collapse: () => void
  /** Wire to the overlay's close button; it receives focus when the overlay opens. */
  closeButtonRef: React.RefObject<HTMLButtonElement | null>
}

/**
 * Local view-state + modal a11y plumbing for an "expand this panel into a
 * focused full-window overlay" affordance — owns the expanded flag and, while
 * open, traps Escape to close, locks body scroll, moves focus to the close
 * button, and restores focus to the trigger on close; auto-collapses when
 * `resetKey` changes so a new subject never inherits an open overlay. Extracted
 * so the host component (e.g. the marketplace preview) stays presentational.
 * @param resetKey - Identity of the current subject; a change collapses the overlay.
 * @returns Expanded flag, `expand`/`collapse` actions, and a `closeButtonRef`.
 * @example
 * const { isExpanded, expand, collapse, closeButtonRef } = useFocusedOverlay(skill.url)
 */
export function useFocusedOverlay(resetKey: string): FocusedOverlayState {
  const [isExpanded, setIsExpanded] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  // The element focused immediately before expanding, restored on collapse.
  const triggerElementRef = useRef<HTMLElement | null>(null)

  const expand = (): void => {
    triggerElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setIsExpanded(true)
  }

  const collapse = (): void => setIsExpanded(false)

  // A new subject (e.g. switching previewed skill) must never open expanded.
  useUpdateEffect(() => {
    setIsExpanded(false)
  }, [resetKey])

  // While expanded: Escape-to-close, body scroll-lock, and focus into the
  // overlay; the cleanup restores scroll + focus when collapsing or unmounting.
  useCycleEffect(() => {
    if (!isExpanded) return

    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsExpanded(false)
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      triggerElementRef.current?.focus()
    }
  }, [isExpanded])

  return { isExpanded, expand, collapse, closeButtonRef }
}
