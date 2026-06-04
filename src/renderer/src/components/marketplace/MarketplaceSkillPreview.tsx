import { ArrowLeft, Check, Copy, Maximize2, X } from 'lucide-react'
import React, { useRef, useState } from 'react'

import { useCopyToClipboard } from '@/renderer/src/hooks/useCopyToClipboard'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { useFocusedOverlay } from '@/renderer/src/hooks/useFocusedOverlay'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch } from '@/renderer/src/redux/hooks'
import { setPreviewSkill } from '@/renderer/src/redux/slices/marketplaceSlice'
import { isAllowedSkillsUrl } from '@/shared/marketplaceUrlPolicy'
import type { SkillSearchResult } from '@/shared/types'

interface MarketplaceSkillPreviewProps {
  skill: SkillSearchResult
}

/**
 * Right-pane webview embed of a skills.sh page.
 * Renders skill.url in an Electron <webview> tag, with loading skeleton
 * and a back button to return to the dashboard.
 *
 * Electron <webview> bypasses X-Frame-Options (separate renderer process),
 * unlike iframe which is blocked by skills.sh CSP.
 */
export const MarketplaceSkillPreview = React.memo(
  function MarketplaceSkillPreview({
    skill,
  }: MarketplaceSkillPreviewProps): React.ReactElement {
    const dispatch = useAppDispatch()
    const webviewRef = useRef<Electron.WebviewTag>(null)
    const [isLoading, setIsLoading] = useState(true)
    // The live URL the webview is showing (skill.url plus any in-allowlist
    // in-page navigation), so the footer + copy reflect what the user sees.
    const [currentUrl, setCurrentUrl] = useState(skill.url)
    const { copied, copy } = useCopyToClipboard()
    // Focused full-window overlay state + modal a11y. Keyed on skill.url so a
    // new skill never inherits an open overlay (this component persists across
    // skill switches). The <webview> node never moves — only its wrapper class
    // flips — so expanding cannot reload the guest page (proven via e2e).
    const { isExpanded, expand, collapse, closeButtonRef } = useFocusedOverlay(
      skill.url,
    )

    const handleBack = (): void => {
      dispatch(setPreviewSkill(null))
    }

    // Validate initial src before rendering the webview
    const isSrcAllowed = isAllowedSkillsUrl(skill.url)

    useCycleEffect(() => {
      // Reset per-skill view state up front so switching skills (this component
      // persists across switches) never carries over a stale URL. (Overlay
      // expansion is reset by useFocusedOverlay's own resetKey effect.)
      setIsLoading(true)
      setCurrentUrl(skill.url)

      const wv = webviewRef.current
      if (!wv || !isSrcAllowed) return

      const handleLoaded = (): void => setIsLoading(false)
      const handleFailed = (): void => setIsLoading(false)

      /** Mirror the live URL into the footer/copy, but only within the allowlist */
      const handleDidNavigate = (
        e: Electron.DidNavigateEvent | Electron.DidNavigateInPageEvent,
      ): void => {
        if (isAllowedSkillsUrl(e.url)) {
          setCurrentUrl(e.url)
        }
      }

      /** Block in-page navigations to non-allowed origins */
      const handleNavigate = (e: Electron.WillNavigateEvent): void => {
        if (!isAllowedSkillsUrl(e.url)) {
          e.preventDefault()
        }
      }

      /** Block window.open() / target="_blank" links from escaping the allowlist */
      const handleNewWindow = (e: Event): void => {
        e.preventDefault()
      }

      wv.addEventListener('did-finish-load', handleLoaded)
      wv.addEventListener('did-fail-load', handleFailed)
      wv.addEventListener('did-navigate', handleDidNavigate)
      wv.addEventListener('did-navigate-in-page', handleDidNavigate)
      wv.addEventListener('will-navigate', handleNavigate)
      wv.addEventListener('new-window', handleNewWindow)
      return () => {
        wv.removeEventListener('did-finish-load', handleLoaded)
        wv.removeEventListener('did-fail-load', handleFailed)
        wv.removeEventListener('did-navigate', handleDidNavigate)
        wv.removeEventListener('did-navigate-in-page', handleDidNavigate)
        wv.removeEventListener('will-navigate', handleNavigate)
        wv.removeEventListener('new-window', handleNewWindow)
      }
    }, [skill.url, isSrcAllowed])

    // Early return when initial URL fails hostname validation
    if (!isSrcAllowed) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <span>Preview unavailable for external URLs</span>
          <button
            type="button"
            onClick={handleBack}
            className="text-primary underline"
          >
            Back to Dashboard
          </button>
        </div>
      )
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header is inert while expanded so its Back/Expand controls leave the
            tab order behind the focused overlay. */}
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          inert={isExpanded}
        >
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors min-h-8"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {skill.name}
            </span>
            <button
              type="button"
              onClick={expand}
              aria-label="Expand preview"
              className="flex items-center justify-center size-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="h-px bg-border shrink-0" />

        {/* Scrim behind the focused overlay; click to collapse. Below the
            webview host (z-40 < z-50) and below toasts so error toasts stay
            visible while expanded. */}
        {isExpanded && (
          <div
            className="fixed inset-0 z-40 bg-black/80 animate-in fade-in-0 duration-150"
            onClick={collapse}
            aria-hidden="true"
          />
        )}

        {/* Stable webview host: rendered once, never re-parented. Only this
            wrapper's className flips between the in-pane slot and the focused
            full-window overlay — moving the <webview> node would detach its
            guest WebContents and reload the page (losing scroll/page state). */}
        <div
          className={cn(
            'min-h-0',
            isExpanded
              ? 'fixed inset-4 z-50 rounded-lg overflow-hidden border border-border shadow-2xl bg-background'
              : 'relative flex-1',
          )}
          role={isExpanded ? 'dialog' : undefined}
          aria-modal={isExpanded ? true : undefined}
          aria-label={isExpanded ? `${skill.name} preview` : undefined}
        >
          {isLoading && <WebviewSkeleton />}
          <webview
            ref={webviewRef}
            src={skill.url}
            partition="marketplace"
            className={`absolute inset-0 ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity`}
            style={{ width: '100%', height: '100%' }}
          />
          {isExpanded && (
            <button
              ref={closeButtonRef}
              type="button"
              onClick={collapse}
              aria-label="Close expanded preview"
              className="absolute top-2 right-2 z-10 flex items-center justify-center size-8 rounded-md bg-background/90 text-muted-foreground shadow-sm border border-border hover:text-foreground hover:bg-background transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Footer carries the live URL + copy; inert while expanded so its copy
            button is not tab-reachable behind the overlay. */}
        <div
          className="px-3 py-1.5 bg-background border-t border-border shrink-0 flex items-center gap-2"
          inert={isExpanded}
        >
          <span
            className="text-[11px] text-muted-foreground font-mono truncate flex-1 min-w-0"
            title={currentUrl}
          >
            {currentUrl}
          </span>
          <button
            type="button"
            onClick={() => {
              void copy(currentUrl, 'preview URL')
            }}
            aria-label="Copy preview URL"
            className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    )
  },
)

/**
 * Skeleton placeholder shown until webview fires did-finish-load or did-fail-load.
 * Mimics the skills.sh page layout with pulse animations.
 */
const WebviewSkeleton = React.memo(
  function WebviewSkeleton(): React.ReactElement {
    return (
      <div className="absolute inset-0 p-8 flex flex-col gap-5 bg-background">
        <div className="h-7 w-48 bg-muted animate-pulse rounded" />
        <div className="h-4 w-36 bg-muted animate-pulse rounded" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-4/5 bg-muted animate-pulse rounded" />
          <div className="h-4 w-3/5 bg-muted animate-pulse rounded" />
        </div>
        <div className="flex gap-6 pt-2">
          <div className="h-10 w-16 bg-muted animate-pulse rounded" />
          <div className="h-10 w-16 bg-muted animate-pulse rounded" />
          <div className="h-10 w-16 bg-muted animate-pulse rounded" />
        </div>
        <div className="h-px bg-border" />
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
        </div>
      </div>
    )
  },
)
