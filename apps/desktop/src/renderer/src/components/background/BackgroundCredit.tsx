import type React from 'react'
import { toast } from 'sonner'

import type { BackgroundCredit as Credit } from '@/shared/backgrounds'

import { UNSPLASH_REFERRAL_SOURCE } from '../../../../../website/src/lib/constants'

/** Renders separate verified attribution links for gallery captions and the main background.
 * @returns Opaque attribution, with plain captions for invalid links and nothing for uploads.
 * @example <BackgroundCredit credit={preview.credit} />
 */
export function BackgroundCredit({
  credit,
}: {
  credit: Credit | null
}): React.ReactElement | null {
  if (!credit) return null
  const photographerUrl = referralUrl(credit.photographerUrl)
  const photoUrl = referralUrl(credit.photoUrl)
  return (
    <span className="opaque-surface flex min-w-0 items-center gap-1 bg-background text-[11px] text-muted-foreground">
      <span>by</span>
      {photographerUrl ? (
        <a
          className="min-h-6 min-w-0 truncate leading-6 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-ring"
          title={credit.photographerName}
          href={photographerUrl}
          onClick={openCredit}
          onAuxClick={openCredit}
        >
          {credit.photographerName}
        </a>
      ) : (
        <span
          className="min-w-0 truncate leading-6"
          title={credit.photographerName}
        >
          {credit.photographerName}
        </span>
      )}
      <span aria-hidden>·</span>
      {photoUrl ? (
        <a
          className="min-h-6 shrink-0 leading-6 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-ring"
          href={photoUrl}
          onClick={openCredit}
          onAuxClick={openCredit}
        >
          Unsplash
        </a>
      ) : (
        <span className="leading-6">Unsplash</span>
      )}
    </span>
  )
}

/** Adds required provider referral parameters while retaining the verified page URL.
 * @returns Public provider attribution URL, or null so corrupt metadata remains a readable caption.
 * @example referralUrl('https://unsplash.com/@mike') // URL with utm_source and utm_medium
 */
function referralUrl(value: string): string | null {
  const url = URL.parse(value)
  if (
    !url ||
    url.origin !== 'https://unsplash.com' ||
    url.username ||
    url.password
  )
    return null
  url.searchParams.set('utm_source', UNSPLASH_REFERRAL_SOURCE)
  url.searchParams.set('utm_medium', 'referral')
  return url.href
}

/** Opens credits through preload so Electron never navigates the application away.
 * @returns Nothing; the native browser receives the verified public URL.
 * @example <a onClick={openCredit} href="https://unsplash.com/..." />
 */
function openCredit(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.type === 'auxclick' && event.button !== 1) return
  event.preventDefault()
  void window.electron.shell
    .openExternal(event.currentTarget.href)
    .catch(() => {
      toast.error('Link could not be opened', {
        description: 'Try again in a moment.',
      })
    })
}
