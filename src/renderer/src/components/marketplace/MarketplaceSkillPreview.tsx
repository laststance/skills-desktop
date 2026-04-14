import { ArrowLeft } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import type { SkillSearchResult } from '../../../../shared/types'
import { useAppDispatch } from '../../redux/hooks'
import { setPreviewSkill } from '../../redux/slices/marketplaceSlice'

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

    const handleBack = (): void => {
      dispatch(setPreviewSkill(null))
    }

    /**
     * Strict origin check — blocks skills.sh.evil.com style bypasses.
     * Only allows https://skills.sh hostnames.
     * @param url - URL string to validate
     * @returns true if hostname is exactly 'skills.sh'
     * @example isAllowedUrl('https://skills.sh/foo') // => true
     * @example isAllowedUrl('https://evil.com') // => false
     */
    const isAllowedUrl = (url: string): boolean => {
      try {
        return new URL(url).origin === 'https://skills.sh'
      } catch {
        return false
      }
    }

    // Validate initial src before rendering the webview
    const isSrcAllowed = isAllowedUrl(skill.url)

    useEffect(() => {
      const wv = webviewRef.current
      if (!wv || !isSrcAllowed) return

      setIsLoading(true)

      const handleLoaded = (): void => setIsLoading(false)
      const handleFailed = (): void => setIsLoading(false)

      /** Block in-page navigations to non-allowed origins */
      const handleNavigate = (e: Electron.WillNavigateEvent): void => {
        if (!isAllowedUrl(e.url)) {
          e.preventDefault()
        }
      }

      /** Block window.open() / target="_blank" links from escaping the allowlist */
      const handleNewWindow = (e: Event): void => {
        e.preventDefault()
      }

      wv.addEventListener('did-finish-load', handleLoaded)
      wv.addEventListener('did-fail-load', handleFailed)
      wv.addEventListener('will-navigate', handleNavigate)
      wv.addEventListener('new-window', handleNewWindow)
      return () => {
        wv.removeEventListener('did-finish-load', handleLoaded)
        wv.removeEventListener('did-fail-load', handleFailed)
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
            className="text-primary underline min-h-[44px]"
          >
            Back to Dashboard
          </button>
        </div>
      )
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Back bar */}
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </button>
          <span className="text-xs text-muted-foreground font-medium">
            {skill.name}
          </span>
        </div>

        {/* Separator */}
        <div className="h-px bg-border shrink-0" />

        {/* Webview area */}
        <div className="flex-1 relative min-h-0">
          {isLoading && <WebviewSkeleton />}
          <webview
            ref={webviewRef}
            src={skill.url}
            partition="marketplace"
            className={`absolute inset-0 ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity`}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* URL bar */}
        <div className="px-3 py-1.5 bg-background border-t border-border shrink-0">
          <span className="text-[11px] text-muted-foreground font-mono">
            {skill.url}
          </span>
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
        {/* Title */}
        <div className="h-7 w-48 bg-muted animate-pulse rounded" />
        {/* Subtitle */}
        <div className="h-4 w-36 bg-muted animate-pulse rounded" />
        {/* Description lines */}
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-4/5 bg-muted animate-pulse rounded" />
          <div className="h-4 w-3/5 bg-muted animate-pulse rounded" />
        </div>
        {/* Stats row */}
        <div className="flex gap-6 pt-2">
          <div className="h-10 w-16 bg-muted animate-pulse rounded" />
          <div className="h-10 w-16 bg-muted animate-pulse rounded" />
          <div className="h-10 w-16 bg-muted animate-pulse rounded" />
        </div>
        {/* Separator */}
        <div className="h-px bg-border" />
        {/* README placeholder */}
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
        </div>
      </div>
    )
  },
)
