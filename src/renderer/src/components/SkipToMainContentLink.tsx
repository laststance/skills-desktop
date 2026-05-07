import { memo } from 'react'
import type { ReactElement } from 'react'

/**
 * Visually hidden anchor that lets keyboard and screen-reader users jump
 * past the sidebar and header straight to the main content region.
 *
 * Why it exists:
 * - WCAG 2.4.1 ("Bypass Blocks") expects a way to skip repeated navigation
 *   so keyboard-only users don't tab through the sidebar on every visit.
 * - The link is hidden via `sr-only` for sighted mouse users (no visual
 *   noise) but becomes visible the moment it receives focus
 *   (`focus:not-sr-only` + fixed positioning), so the first Tab press on
 *   the page reveals a clearly styled "Skip to main content" pill.
 *
 * When it triggers:
 * - User presses Tab once after the window gains focus. Activating the
 *   link (Enter/Space) moves focus to the element with `id="main-content"`
 *   (currently rendered by `MainContent.tsx`).
 *
 * What calls it:
 * - Mounted near the top of the renderer tree (e.g. inside `App` or above
 *   it in `main.tsx`) so it is the first focusable element in tab order.
 *
 * Memoised with `() => true` because the component takes no props and its
 * markup never changes — re-renders from parent state updates are wasted
 * work that this guard cheaply skips.
 *
 * @example
 * // Place once, near the top of the tree:
 * <SkipToMainContentLink />
 * <main id="main-content">...</main>
 */
export const SkipToMainContentLink = memo(
  (): ReactElement => {
    return (
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:left-0 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:p-2"
      >
        [Press Enter] Skip forcus to main content
      </a>
    )
  },
  () => true,
)
