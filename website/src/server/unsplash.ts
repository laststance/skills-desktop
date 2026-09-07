import { implement, ORPCError } from '@orpc/server'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'

import {
  UNSPLASH_API_ORIGIN,
  UNSPLASH_MAX_PAGE,
  UNSPLASH_PAGE_SIZE,
  UNSPLASH_REFERRAL_SOURCE,
  UNSPLASH_SEARCH_CACHE_SECONDS,
} from '../lib/constants'
import {
  unsplashContract,
  UnsplashSearchResultSchema,
  type UnsplashSearchInput,
  type UnsplashSearchResult,
} from '../lib/unsplash-contract'

import {
  MILLISECONDS_PER_SECOND,
  UNSPLASH_REQUEST_TIMEOUT_MS,
  UNSPLASH_RETRY_MAX_SECONDS,
} from './constants'
import { readProviderJson } from './utils/readProviderJson'

/** Only fields needed by the public contract are retained from a bounded upstream response. */
const providerPhotoSchema = z.object({
  id: z.string(),
  width: z.number(),
  height: z.number(),
  description: z.string().nullish(),
  alt_description: z.string().nullish(),
  urls: z.object({ raw: z.url(), small: z.url() }),
  links: z.object({ html: z.url(), download_location: z.url() }),
  user: z.object({
    name: z.string(),
    username: z.string(),
    links: z.object({ html: z.url() }),
  }),
})
const providerSearchSchema = z.object({
  total_pages: z.number().int().nonnegative(),
  results: z.array(providerPhotoSchema).max(UNSPLASH_PAGE_SIZE),
})

/** Reads the server credential only when a procedure runs; desktop bundles import the separate public contract.
 * @returns The server-owned API key, or a typed unavailable failure without credential details.
 * @example requireAccessKey() // Reads UNSPLASH_ACCESS_KEY on the server only.
 */
function requireAccessKey(): string {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim()
  if (!key)
    throw new ORPCError('UNAVAILABLE', {
      status: 503,
      message:
        'Online backgrounds are not configured yet. Try a built-in image or upload.',
    })
  return key
}

/** Adds provider-required referral parameters while {@link searchProvider} normalizes validated credit links.
 * @param value - Upstream photographer or photo page URL.
 * @returns The same page with Skills Desktop referral attribution.
 * @example creditLink('https://unsplash.com/@mike') // Adds utm_source and utm_medium.
 */
function creditLink(value: string): string {
  const url = new URL(value)
  url.searchParams.set('utm_source', UNSPLASH_REFERRAL_SOURCE)
  url.searchParams.set('utm_medium', 'referral')
  return url.href
}

/** Fetches bounded provider JSON for {@link searchProvider} and download tracking without retries or redirects.
 * @param url - Validated fixed-origin provider endpoint.
 * @param notification - A network failure after notification dispatch may mean the action happened.
 * @returns Parsed JSON, or a recoverable typed failure with no upstream body or credential leakage.
 * @example requestProvider(new URL('https://api.unsplash.com/search/photos?query=lake'), false)
 */
async function requestProvider(
  url: URL,
  notification: boolean,
): Promise<unknown> {
  // Recheck the credential destination at the shared fetch boundary before building authorization headers.
  if (
    url.origin !== UNSPLASH_API_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Unsupported photo provider URL.',
    })
  }
  const key = requireAccessKey()
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UNSPLASH_REQUEST_TIMEOUT_MS),
    })
    // Failed responses need no body; cancel their stream before surfacing a recoverable error.
    if (!response.ok) await response.body?.cancel().catch(() => undefined)
    // Redirects never get a second request, even when the destination appears to be Unsplash.
    if (response.status >= 300 && response.status < 400) {
      throw new ORPCError('UNAVAILABLE', {
        status: 503,
        message:
          'The photo provider returned an unsupported redirect. Try again later.',
      })
    }
    if (response.status === 429) {
      const retryHeader = response.headers.get('retry-after')
      const retrySeconds =
        retryHeader && /^\d+$/.test(retryHeader)
          ? Number(retryHeader)
          : retryHeader
            ? Math.ceil(
                (Date.parse(retryHeader) - Date.now()) /
                  MILLISECONDS_PER_SECOND,
              )
            : Number.NaN
      const retryAfterSeconds = Number.isFinite(retrySeconds)
        ? Math.min(UNSPLASH_RETRY_MAX_SECONDS, Math.max(0, retrySeconds))
        : null
      throw new ORPCError('RATE_LIMITED', {
        status: 429,
        message:
          'The photo provider quota is temporarily exhausted. Try again later.',
        data: { retryAfterSeconds },
      })
    }
    if (!response.ok) {
      throw new ORPCError('UNAVAILABLE', {
        status: 503,
        message:
          'The photo provider is temporarily unavailable. Try again later.',
      })
    }
    return await readProviderJson(response)
  } catch (error) {
    if (error instanceof ORPCError) throw error
    if (notification) {
      throw new ORPCError('NOTIFICATION_UNCERTAIN', {
        status: 504,
        message:
          'The provider may have recorded this application, but confirmation did not arrive. Retry only when you are ready to notify it again.',
      })
    }
    if (error instanceof RangeError || error instanceof SyntaxError) {
      throw new ORPCError('INVALID_RESPONSE', {
        status: 502,
        message:
          'The photo provider returned an invalid response. Try again later.',
      })
    }
    throw new ORPCError('UNAVAILABLE', {
      status: 503,
      message:
        'Photos could not be loaded from the provider. Check your connection and try again.',
    })
  }
}

/** Normalizes validated provider results before {@link cachedSearch} may persist a successful search.
 * @param input - Bounded normalized query and page from the public contract.
 * @returns Validated public photo metadata with a bounded next page.
 * @example searchProvider({ query: 'alpine lake', page: 1 }) // { items, nextPage }.
 */
async function searchProvider(
  input: UnsplashSearchInput,
): Promise<UnsplashSearchResult> {
  const url = new URL('/search/photos', UNSPLASH_API_ORIGIN)
  url.search = new URLSearchParams({
    query: input.query,
    page: String(input.page),
    per_page: String(UNSPLASH_PAGE_SIZE),
    content_filter: 'high',
  }).toString()
  const provider = providerSearchSchema.safeParse(
    await requestProvider(url, false),
  )
  if (!provider.success)
    throw new ORPCError('INVALID_RESPONSE', {
      status: 502,
      message:
        'The photo provider returned invalid gallery data. Try again later.',
    })
  const items = provider.data.results.map((photo) => ({
    id: photo.id,
    width: photo.width,
    height: photo.height,
    description: photo.description ?? null,
    altDescription: photo.alt_description ?? null,
    urls: photo.urls,
    links: {
      html: creditLink(photo.links.html),
      downloadLocation: photo.links.download_location,
    },
    photographer: {
      name: photo.user.name,
      username: photo.user.username,
      profileUrl: creditLink(photo.user.links.html),
    },
  }))
  const result = UnsplashSearchResultSchema.safeParse({
    items,
    nextPage:
      items.length > 0 &&
      input.page < provider.data.total_pages &&
      input.page < UNSPLASH_MAX_PAGE
        ? input.page + 1
        : null,
  })
  if (!result.success)
    throw new ORPCError('INVALID_RESPONSE', {
      status: 502,
      message:
        'The photo provider returned unsupported photo metadata. Try again later.',
    })
  return result.data
}

// Next's shared Data Cache stores only fulfilled, fully validated results; failures and notifications never enter it.
const cachedSearch = unstable_cache(
  searchProvider,
  ['unsplash-gallery-search-v1'],
  { revalidate: UNSPLASH_SEARCH_CACHE_SECONDS },
)
const contract = implement(unsplashContract)

/** Only the Next Route Handler imports this server implementation; clients depend on {@link unsplashContract}. */
export const unsplashRouter = contract.router({
  unsplash: {
    search: contract.unsplash.search.handler(({ input }) => {
      requireAccessKey()
      return cachedSearch(input)
    }),
    trackDownload: contract.unsplash.trackDownload.handler(
      async ({ input }) => {
        const response = await requestProvider(
          new URL(input.downloadLocation),
          true,
        )
        const download = z.object({ url: z.url() }).safeParse(response)
        // The documented acknowledgement URL is never fetched or rendered; only its JSON/HTTPS shape matters.
        const imageUrl = download.success ? URL.parse(download.data.url) : null
        if (
          !imageUrl ||
          imageUrl.protocol !== 'https:' ||
          imageUrl.username ||
          imageUrl.password
        ) {
          throw new ORPCError('NOTIFICATION_UNCERTAIN', {
            status: 504,
            message:
              'The provider may have recorded this application, but its response could not be verified. Retry only when you are ready to notify it again.',
          })
        }
        return { acknowledged: true }
      },
    ),
  },
})
