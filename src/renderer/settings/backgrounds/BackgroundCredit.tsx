import type React from 'react'

import type { BackgroundCredit as Credit } from '@/shared/backgrounds'

import { UNSPLASH_REFERRAL_SOURCE } from '../../../../website/src/lib/constants'

/** Renders separate verified attribution links for gallery captions and the main background.
 * @returns Opaque, keyboard-accessible photographer and Unsplash credits, or nothing for uploads.
 * @example <BackgroundCredit credit={preview.credit} />
 */
export function BackgroundCredit({
  credit,
}: {
  credit: Credit | null
}): React.ReactElement | null {
  if (!credit) return null
  return (
    <span className="opaque-surface flex min-w-0 items-center gap-1 bg-background text-[11px] text-muted-foreground">
      <span>by</span>
      <a
        className="min-h-6 min-w-0 truncate leading-6 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-ring"
        title={credit.photographerName}
        href={referralUrl(credit.photographerUrl)}
        onClick={openCredit}
      >
        {credit.photographerName}
      </a>
      <span aria-hidden>·</span>
      <a
        className="min-h-6 shrink-0 leading-6 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-ring"
        href={referralUrl(credit.photoUrl)}
        onClick={openCredit}
      >
        Unsplash
      </a>
    </span>
  )
}

/** Adds required provider referral parameters while retaining the verified page URL.
 * @returns Attribution URL for a normal external link.
 * @example referralUrl('https://unsplash.com/@mike') // URL with utm_source and utm_medium
 */
function referralUrl(value: string): string {
  const url = new URL(value)
  url.searchParams.set('utm_source', UNSPLASH_REFERRAL_SOURCE)
  url.searchParams.set('utm_medium', 'referral')
  return url.href
}

/** Opens credits through preload so Electron never navigates the application away.
 * @returns Nothing; the native browser receives the verified public URL.
 * @example <a onClick={openCredit} href="https://unsplash.com/..." />
 */
function openCredit(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void window.electron.shell.openExternal(event.currentTarget.href)
}
