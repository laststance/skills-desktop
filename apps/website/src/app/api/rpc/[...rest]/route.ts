import { BodyLimitPlugin, RPCHandler } from '@orpc/server/fetch'

import {
  UNSPLASH_CORS_MAX_AGE_SECONDS,
  UNSPLASH_MAX_REQUEST_BYTES,
  UNSPLASH_MAX_REQUEST_URL_LENGTH,
} from '../../../../server/constants'
import { unsplashRouter } from '../../../../server/unsplash'

export const runtime = 'nodejs'

const handler = new RPCHandler(unsplashRouter, {
  plugins: [new BodyLimitPlugin({ maxBodySize: UNSPLASH_MAX_REQUEST_BYTES })],
})

/** Allows opaque packaged origins and explicit loopback development surfaces; CORS never replaces hosting rate enforcement.
 * @param origin - Browser-provided Origin header, including the literal packaged value `null`.
 * @param requestUrl - The current Website deployment URL.
 * @returns Whether this origin may read a public gallery response.
 * @example allowedOrigin('null', 'https://skills-desktop.vercel.app/api/rpc') // true.
 */
function allowedOrigin(origin: string, requestUrl: string): boolean {
  if (origin === 'null' || origin === new URL(requestUrl).origin) return true
  const parsed = URL.parse(origin)
  return Boolean(
    parsed &&
    origin === parsed.origin &&
    parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname),
  )
}

/** Runs the public oRPC endpoint with bounded requests and explicit desktop CORS for Next POST/OPTIONS.
 * @param request - Incoming HTTP request; credentials are read only by the server procedure.
 * @returns An oRPC response or a bounded origin/method/request rejection.
 * @example POST(new Request('https://skills-desktop.vercel.app/api/rpc/unsplash/search', { method: 'POST' }))
 */
async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  const headers = new Headers({ Vary: 'Origin', 'Cache-Control': 'no-store' })
  if (origin && !allowedOrigin(origin, request.url))
    return new Response('Origin is not allowed', { status: 403, headers })
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Expose-Headers', 'Retry-After')
  if (request.method === 'OPTIONS') {
    const requestedHeaders = (
      request.headers.get('access-control-request-headers') ?? ''
    )
      .toLowerCase()
      .split(',')
      .map((header) => header.trim())
      .filter(Boolean)
    if (
      request.headers.get('access-control-request-method') !== 'POST' ||
      requestedHeaders.some((header) => header !== 'content-type')
    )
      return new Response('Unsupported preflight request', {
        status: 405,
        headers,
      })
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Access-Control-Max-Age', String(UNSPLASH_CORS_MAX_AGE_SECONDS))
    return new Response(null, { status: 204, headers })
  }
  if (request.url.length > UNSPLASH_MAX_REQUEST_URL_LENGTH)
    return new Response('Request URL is too long', { status: 414, headers })
  // Next proxies Request; rebuild from public fields so oRPC's bounded-body clone keeps native private slots.
  const requestInit = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    duplex: 'half',
  }
  const result = await handler.handle(new Request(request.url, requestInit), {
    prefix: '/api/rpc',
  })
  const response = result.response ?? new Response('Not found', { status: 404 })
  // The shared search Data Cache is independent of HTTP responses; download responses always remain no-store.
  headers.forEach((value, name) => response.headers.set(name, value))
  return response
}

export { handleRequest as POST, handleRequest as OPTIONS }
