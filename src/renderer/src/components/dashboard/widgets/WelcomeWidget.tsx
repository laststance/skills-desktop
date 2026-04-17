import { Hand, Store, X } from 'lucide-react'
import React from 'react'

import { useAppDispatch, useAppSelector } from '../../../redux/hooks'
import {
  dismissWelcome,
  removeWidget,
  selectWelcomeDismissed,
} from '../../../redux/slices/dashboardSlice'
import { setActiveTab } from '../../../redux/slices/uiSlice'
import type { WidgetInstance } from '../types'

interface WelcomeWidgetProps {
  instance: WidgetInstance
}

/**
 * Welcome widget body.
 *
 * Introductory hero card for first-time users. Dismissal is a two-step
 * commit: we flip the persisted `welcomeDismissed` flag (so re-adding the
 * widget from the picker shows a muted hint instead of the full pitch) AND
 * we remove the widget instance so it disappears immediately without the
 * user having to enter edit mode.
 *
 * The "Open Marketplace" CTA is a shortcut to the primary discovery
 * surface — most first-time users want to grab a skill, and this is the
 * fastest path.
 */
export const WelcomeWidget = React.memo(function WelcomeWidget({
  instance,
}: WelcomeWidgetProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const isDismissed = useAppSelector(selectWelcomeDismissed)

  const handleDismiss = (): void => {
    dispatch(dismissWelcome())
    dispatch(removeWidget(instance.id))
  }

  const handleOpenMarketplace = (): void => {
    dispatch(setActiveTab('marketplace'))
  }

  // Re-added from the picker after prior dismissal: render a compact hint so
  // the widget isn't noisy for returning users, while still being removable.
  if (isDismissed) {
    return (
      <div className="h-full w-full flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          Welcome card dismissed — remove in edit mode, or reset layout to
          restore.
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Remove welcome widget"
          className="
            min-h-[44px] min-w-[44px] shrink-0
            inline-flex items-center justify-center rounded-md
            text-muted-foreground hover:text-foreground hover:bg-muted
            transition-colors focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-ring
          "
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col justify-between gap-3 px-5 py-4">
      <div className="flex items-start gap-3">
        <div
          className="
            shrink-0 inline-flex items-center justify-center
            w-9 h-9 rounded-lg bg-primary/10 text-primary
          "
        >
          <Hand className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            Welcome to Skills Desktop
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Visualize and manage shared skills across your AI agents. Install
            from the marketplace, link them into Claude / Cursor / Codex, and
            keep every agent in sync from one place.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss welcome"
          className="
            min-h-[44px] min-w-[44px] shrink-0
            inline-flex items-center justify-center rounded-md
            text-muted-foreground hover:text-foreground hover:bg-muted
            transition-colors focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-ring
          "
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpenMarketplace}
          className="
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
            bg-primary text-primary-foreground text-xs font-semibold
            hover:bg-primary/90 transition-colors focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-ring
            min-h-[44px]
          "
        >
          <Store className="h-3.5 w-3.5" aria-hidden="true" />
          Open Marketplace
        </button>
      </div>
    </div>
  )
})
