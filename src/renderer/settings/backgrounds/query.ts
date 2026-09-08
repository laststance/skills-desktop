import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { QueryClient } from '@tanstack/react-query'

import { UNSPLASH_RPC_URL } from '../../../../website/src/lib/constants'
import type { UnsplashClient } from '../../../../website/src/lib/unsplash-contract'

import { UNSPLASH_SEARCH_TIMEOUT_MS } from './constants'

/** One remote cache per Settings lifetime; returning to Appearance preserves loaded pages. */
export const backgroundQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retryOnMount: false,
    },
  },
})
const client: UnsplashClient = createORPCClient(
  new RPCLink({
    url: UNSPLASH_RPC_URL,
    fetch: async (request, init) =>
      globalThis.fetch(request, {
        ...init,
        // Preserve TanStack cancellation while bounding unreachable hosting/network requests too.
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(UNSPLASH_SEARCH_TIMEOUT_MS),
        ]),
      }),
  }),
)
export const backgroundRpc = createTanstackQueryUtils(client)
