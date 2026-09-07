import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { QueryClient } from '@tanstack/react-query'

import { UNSPLASH_RPC_URL } from '../../../../website/src/lib/constants'
import type { UnsplashClient } from '../../../../website/src/lib/unsplash-contract'

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
    fetch: async (request, init) => globalThis.fetch(request, init),
  }),
)
export const backgroundRpc = createTanstackQueryUtils(client)
