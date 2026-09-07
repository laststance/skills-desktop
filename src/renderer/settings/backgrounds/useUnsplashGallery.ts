import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { useDebouncedCallback } from '@/renderer/src/hooks/useDebouncedCallback'
import type { BackgroundCatalogItem } from '@/shared/backgrounds'

import {
  UNSPLASH_DEFAULT_QUERY,
  UNSPLASH_QUERY_STALE_TIME_MS,
  UNSPLASH_SEARCH_DEBOUNCE_MS,
} from '../../../../website/src/lib/constants'

import { backgroundRpc } from './query'

/** Keeps remote pages in the real oRPC query cache; only search, pagination and explicit Refresh fetch.
 * @returns Deduplicated photos, search input and recoverable pagination state.
 * @example const photos = useUnsplashGallery(isUnsplashVisible)
 */
export function useUnsplashGallery(enabled: boolean) {
  const [search, setSearch] = useState(UNSPLASH_DEFAULT_QUERY)
  const [query, setQuery] = useState(UNSPLASH_DEFAULT_QUERY)
  const debounce = useDebouncedCallback(
    (value: string) => setQuery(value.trim()),
    UNSPLASH_SEARCH_DEBOUNCE_MS,
  )
  const client = useQueryClient()
  const fetchingMore = useRef(false)
  const options = backgroundRpc.unsplash.search.infiniteOptions({
    input: (page: number) => ({ query, page }),
    initialPageParam: 1,
    getNextPageParam: (page) => page.nextPage,
    staleTime: UNSPLASH_QUERY_STALE_TIME_MS,
    retry: false,
    refetchOnMount: false,
    retryOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const [hasOpened, setHasOpened] = useState(() => {
    const cached = client.getQueryState(options.queryKey)
    // A disabled observer creates an empty query too; only previous requests count as an opened gallery.
    return (
      enabled ||
      Boolean(
        cached &&
        (cached.data !== undefined ||
          cached.status === 'error' ||
          cached.fetchStatus === 'fetching'),
      )
    )
  })
  // Keep an opened observer active through tab/Crop changes, without refetching cached remounts.
  const result = useInfiniteQuery({
    ...options,
    enabled: (hasOpened || enabled) && Boolean(query),
  })
  const seen = new Set<string>()
  const items: BackgroundCatalogItem[] = []
  // Duplicate provider IDs must not create duplicate radio targets across pages.
  for (const page of result.data?.pages ?? [])
    for (const photo of page.items) {
      if (seen.has(photo.id)) continue
      seen.add(photo.id)
      items.push({
        source: { kind: 'unsplash', photo },
        title:
          photo.altDescription ??
          photo.description ??
          `Photo by ${photo.photographer.name}`,
        width: photo.width,
        height: photo.height,
        thumbnail: {
          url: photo.urls.small,
          width: photo.width,
          height: photo.height,
        },
        credit: {
          photographerName: photo.photographer.name,
          photographerUrl: photo.photographer.profileUrl,
          photoUrl: photo.links.html,
        },
      })
    }
  const loadMore = async (): Promise<void> => {
    if (!result.hasNextPage || result.isFetching || fetchingMore.current) return
    fetchingMore.current = true
    try {
      await result.fetchNextPage({ cancelRefetch: false })
    } finally {
      fetchingMore.current = false
    }
  }
  const refresh = async (): Promise<void> => {
    await client.cancelQueries({ queryKey: options.queryKey, exact: true })
    // Reset removes previously loaded pages before fetching page one; a stale remount never does this.
    await client.resetQueries({ queryKey: options.queryKey, exact: true })
  }
  return {
    ...result,
    items,
    search,
    query,
    loadMore,
    refresh,
    open: (): void => setHasOpened(true),
    changeSearch: (value: string): void => {
      setSearch(value)
      debounce.run(value)
    },
  }
}
