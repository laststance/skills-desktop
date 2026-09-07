// Next initializes AsyncLocalStorage before its Data Cache; match that boot order in the Node test lane.
import 'next/dist/server/node-environment-baseline'

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { IncrementalCache } from 'next/dist/server/lib/incremental-cache'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OPTIONS, POST } from '../app/api/rpc/[...rest]/route'
import type { UnsplashClient } from '../lib/unsplash-contract'

const upstreamPhoto = {
  id: '5oRIcisKaxU',
  width: 4608,
  height: 3072,
  description: null,
  alt_description: 'A lake under alpine mountains',
  urls: {
    raw: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?ixid=public-tracking&ixlib=rb-4.1.0',
    small:
      'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?ixid=public-tracking&w=400',
  },
  links: {
    html: 'https://unsplash.com/photos/lake-5oRIcisKaxU',
    download_location:
      'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=public-tracking',
  },
  user: {
    name: 'Mike Petrucci',
    username: 'mikepetrucci',
    links: { html: 'https://unsplash.com/@mikepetrucci' },
  },
}

const validDownload = {
  photoId: '5oRIcisKaxU',
  downloadLocation:
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=public-tracking',
}
const fetchProvider = vi.fn<typeof fetch>()
const fetchOverHttp = globalThis.fetch
const client = createORPCClient<UnsplashClient>(
  new RPCLink({
    url: 'https://skills-desktop.vercel.app/api/rpc',
    fetch: (request) => POST(request),
  }),
)
let cacheDirectory: string
let incrementalCache: IncrementalCache

describe('Unsplash proxy through the public oRPC transport', () => {
  beforeEach(async () => {
    cacheDirectory = await mkdtemp(join(tmpdir(), 'skills-unsplash-cache-'))
    // Exercise Next's real Data Cache rather than a fake memoization implementation.
    incrementalCache = new IncrementalCache({
      dev: false,
      requestHeaders: {},
      serverDistDir: cacheDirectory,
      flushToDisk: false,
      maxMemoryCacheSize: 10 * 1024 * 1024,
      fetchCacheKeyPrefix: randomUUID(),
      fs: {
        existsSync,
        readFile,
        readFileSync,
        writeFile,
        mkdir: (directory) => mkdir(directory, { recursive: true }),
        stat,
      },
      getPrerenderManifest: () => ({
        version: 4,
        routes: {},
        dynamicRoutes: {},
        notFoundRoutes: [],
        preview: {
          previewModeId: 'test-preview',
          previewModeEncryptionKey: 'test-encryption',
          previewModeSigningKey: 'test-signing',
        },
      }),
    })
    vi.stubGlobal('__incrementalCache', incrementalCache)
    vi.stubGlobal('fetch', fetchProvider)
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'unit-test-server-key')
    fetchProvider.mockReset()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(cacheDirectory, { recursive: true, force: true })
  })

  it('returns verified hotlinks and photographer credits with referral tracking', async () => {
    // Arrange
    fetchProvider.mockResolvedValue(
      Response.json({ total_pages: 2, results: [upstreamPhoto] }),
    )
    // Act
    const result = await client.unsplash.search({ query: 'lake', page: 1 })
    // Assert
    expect(result).toEqual({
      items: [
        {
          id: '5oRIcisKaxU',
          width: 4608,
          height: 3072,
          description: null,
          altDescription: 'A lake under alpine mountains',
          urls: {
            raw: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?ixid=public-tracking&ixlib=rb-4.1.0',
            small:
              'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?ixid=public-tracking&w=400',
          },
          links: {
            html: 'https://unsplash.com/photos/lake-5oRIcisKaxU?utm_source=skills-desktop&utm_medium=referral',
            downloadLocation:
              'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=public-tracking',
          },
          photographer: {
            name: 'Mike Petrucci',
            username: 'mikepetrucci',
            profileUrl:
              'https://unsplash.com/@mikepetrucci?utm_source=skills-desktop&utm_medium=referral',
          },
        },
      ],
      nextPage: 2,
    })
    expect(String(fetchProvider.mock.calls[0]?.[0])).toBe(
      'https://api.unsplash.com/search/photos?query=lake&page=1&per_page=30&content_filter=high',
    )
    expect(fetchProvider.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        Authorization: 'Client-ID unit-test-server-key',
        'Accept-Version': 'v1',
      },
    })
  })

  it('shares validated searches for sixty seconds and then revalidates the real Next Data Cache', async () => {
    // Arrange
    const cacheWrite = vi.spyOn(incrementalCache, 'set')
    fetchProvider.mockImplementation(async () =>
      Response.json({ total_pages: 1, results: [upstreamPhoto] }),
    )
    // Act
    const first = await client.unsplash.search({ query: 'lake', page: 1 })
    const second = await client.unsplash.search({ query: ' lake ', page: 1 })
    // Assert
    expect(second).toEqual(first)
    expect(fetchProvider).toHaveBeenCalledTimes(1)
    expect(cacheWrite.mock.calls[0]?.[1]).toMatchObject({ revalidate: 60 })
    // Move only the cache's age clock; the installed Next implementation decides whether to fetch again.
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 61_000)
    await client.unsplash.search({ query: 'lake', page: 1 })
    expect(fetchProvider).toHaveBeenCalledTimes(2)
  })

  it('keeps failed and malformed searches out of the successful result cache', async () => {
    // Arrange
    const cacheWrite = vi.spyOn(incrementalCache, 'set')
    fetchProvider.mockResolvedValueOnce(
      Response.json({
        results: [
          {
            ...upstreamPhoto,
            urls: {
              raw: 'https://evil.test/photo',
              small: 'https://evil.test/thumb',
            },
          },
        ],
        total_pages: 1,
      }),
    )
    fetchProvider.mockResolvedValueOnce(
      Response.json({ results: [upstreamPhoto], total_pages: 1 }),
    )
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(cacheWrite).not.toHaveBeenCalled()
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).resolves.toMatchObject({ nextPage: null })
    expect(fetchProvider).toHaveBeenCalledTimes(2)
    expect(cacheWrite).toHaveBeenCalledTimes(1)
  })

  it('normalizes absent optional descriptions and ends empty pages without another fetch', async () => {
    // Arrange
    fetchProvider.mockResolvedValueOnce(
      Response.json({
        total_pages: 1,
        results: [
          {
            ...upstreamPhoto,
            description: undefined,
            alt_description: undefined,
          },
        ],
      }),
    )
    fetchProvider.mockResolvedValueOnce(
      Response.json({ total_pages: 100, results: [] }),
    )
    // Act
    const first = await client.unsplash.search({ query: 'lake', page: 1 })
    const empty = await client.unsplash.search({ query: 'other', page: 1 })
    // Assert
    expect(first.items[0]).toMatchObject({
      description: null,
      altDescription: null,
    })
    expect(first.nextPage).toBeNull()
    expect(empty).toEqual({ items: [], nextPage: null })
  })

  it('returns a clear unavailable error without contacting Unsplash when the key is absent', async () => {
    // Arrange
    vi.stubEnv('UNSPLASH_ACCESS_KEY', '')
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 })
    await expect(
      client.unsplash.trackDownload(validDownload),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 })
    expect(fetchProvider).not.toHaveBeenCalled()
  })

  it.each([401, 403, 500, 503])(
    'sanitizes provider HTTP %i errors without exposing its body or retrying',
    async (status) => {
      // Arrange
      fetchProvider.mockResolvedValue(
        new Response('private diagnostic with unit-test-server-key', {
          status,
        }),
      )
      // Act / Assert
      await expect(
        client.unsplash.search({ query: 'lake', page: 1 }),
      ).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        message:
          'The photo provider is temporarily unavailable. Try again later.',
      })
      expect(fetchProvider).toHaveBeenCalledTimes(1)
    },
  )

  it('exposes a recoverable quota interval and never retries the quota response', async () => {
    // Arrange
    fetchProvider.mockResolvedValue(
      new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
    )
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      data: { retryAfterSeconds: 120 },
    })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it('keeps the quota reset time unknown when the provider supplies none', async () => {
    // Arrange
    fetchProvider.mockResolvedValue(new Response(null, { status: 429 }))
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      data: { retryAfterSeconds: null },
    })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it.each([
    { query: '', page: 1 },
    { query: 'lake', page: 0 },
    { query: 'lake', page: 1001 },
  ])(
    'rejects invalid search input before calling the provider: %j',
    async (input) => {
      // Arrange / Act / Assert
      await expect(client.unsplash.search(input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
      expect(fetchProvider).not.toHaveBeenCalled()
    },
  )

  it('does not cache or automatically repeat acknowledged download notifications', async () => {
    // Arrange
    const cacheWrite = vi.spyOn(incrementalCache, 'set')
    fetchProvider.mockImplementation(async () =>
      Response.json({
        url: 'https://image.unsplash.com/example',
      }),
    )
    // Act
    const first = await client.unsplash.trackDownload(validDownload)
    const second = await client.unsplash.trackDownload(validDownload)
    // Assert
    expect(first).toEqual({ acknowledged: true })
    expect(second).toEqual({ acknowledged: true })
    expect(fetchProvider).toHaveBeenCalledTimes(2)
    expect(cacheWrite).not.toHaveBeenCalled()
    expect(String(fetchProvider.mock.calls[0]?.[0])).toBe(
      'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=public-tracking',
    )
  })

  it.each([
    'https://evil.test/photos/5oRIcisKaxU/download',
    'https://api.unsplash.com/photos/other/download',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?client_id=stolen',
    'https://api.unsplash.com/photos/5oRIcisKaxU/download?ixid=a&ixid=b',
  ])(
    'rejects unsafe download input before any credentialed fetch: %s',
    async (downloadLocation) => {
      // Arrange / Act / Assert
      await expect(
        client.unsplash.trackDownload({
          photoId: '5oRIcisKaxU',
          downloadLocation,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(fetchProvider).not.toHaveBeenCalled()
    },
  )

  it('rejects a provider redirect without ever fetching its target', async () => {
    // Arrange
    fetchProvider.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.test/collect' },
      }),
    )
    // Act / Assert
    await expect(
      client.unsplash.trackDownload(validDownload),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
    expect(fetchProvider.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })

  it('reports timeout uncertainty instead of silently retrying a notification', async () => {
    // Arrange
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    fetchProvider.mockRejectedValue(
      new DOMException('Timed out', 'TimeoutError'),
    )
    // Act / Assert
    await expect(
      client.unsplash.trackDownload(validDownload),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_UNCERTAIN', status: 504 })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
    expect(fetchProvider.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(timeout).toHaveBeenCalledWith(10_000)
  })

  it('reports malformed acknowledgement uncertainty without caching the operation', async () => {
    // Arrange
    fetchProvider.mockResolvedValue(Response.json({ url: 'not-a-valid-url' }))
    // Act / Assert
    await expect(
      client.unsplash.trackDownload(validDownload),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_UNCERTAIN' })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized declared responses before reading their body', async () => {
    // Arrange
    const cancelBody = vi.fn()
    fetchProvider.mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelBody }), {
        headers: { 'Content-Length': '2097153' },
      }),
    )
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(cancelBody).toHaveBeenCalledOnce()
  })

  it('accepts valid provider JSON at the exact upstream byte limit', async () => {
    // Arrange
    const body = '{"total_pages":0,"results":[]}'.padEnd(2_097_152, ' ')
    fetchProvider.mockResolvedValue(
      new Response(body, { headers: { 'Content-Length': '2097152' } }),
    )
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).resolves.toEqual({ items: [], nextPage: null })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it('also bounds actual streamed bytes when Content-Length is missing', async () => {
    // Arrange
    const cancelBody = vi.fn()
    fetchProvider.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(2_097_153))
          },
          cancel: cancelBody,
        }),
      ),
    )
    // Act / Assert
    await expect(
      client.unsplash.search({ query: 'lake', page: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(cancelBody).toHaveBeenCalledOnce()
  })

  it.each([
    'null',
    'http://localhost:5173',
    'http://127.0.0.1:4179',
    'http://[::1]:5173',
    'https://skills-desktop.vercel.app',
  ])(
    'allows the explicit desktop/development origin %s without credentials',
    async (origin) => {
      // Arrange
      const request = new Request(
        'https://skills-desktop.vercel.app/api/rpc/unsplash/search',
        {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
          },
        },
      )
      // Act
      const response = await OPTIONS(request)
      // Assert
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(
        response.headers.get('Access-Control-Allow-Credentials'),
      ).toBeNull()
      expect(response.headers.get('Vary')).toBe('Origin')
      expect(fetchProvider).not.toHaveBeenCalled()
    },
  )

  it.each([
    'https://evil.test',
    'http://localhost.evil.test:5173',
    'http://user@localhost:5173',
  ])(
    'blocks an unrelated or malformed origin before provider work: %s',
    async (origin) => {
      // Arrange
      const request = new Request(
        'https://skills-desktop.vercel.app/api/rpc/unsplash/search',
        {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{"json":{"query":"lake","page":1}}',
        },
      )
      // Act
      const response = await POST(request)
      // Assert
      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(fetchProvider).not.toHaveBeenCalled()
    },
  )

  it('rejects oversized incoming bodies at the installed oRPC adapter boundary', async () => {
    // Arrange
    const request = new Request(
      'https://skills-desktop.vercel.app/api/rpc/unsplash/search',
      {
        method: 'POST',
        headers: { Origin: 'null', 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { query: 'x'.repeat(8_193), page: 1 } }),
      },
    )
    // Act
    const response = await POST(request)
    // Assert
    expect(response.status).toBe(413)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetchProvider).not.toHaveBeenCalled()
  })

  it('accepts the proxied Next request without breaking native Request private fields', async () => {
    // Arrange
    fetchProvider.mockResolvedValue(
      Response.json({ total_pages: 1, results: [upstreamPhoto] }),
    )
    const request = new Request(
      'https://skills-desktop.vercel.app/api/rpc/unsplash/search',
      {
        method: 'POST',
        headers: { Origin: 'null', 'Content-Type': 'application/json' },
        body: '{"json":{"query":"lake","page":1}}',
      },
    )
    // Next tracks route access with a Proxy that retains Request getters' original receiver.
    const nextRequest = new Proxy(request, {
      get: (target, property) => Reflect.get(target, property, target),
    })
    // Act
    const response = await POST(nextRequest)
    // Assert
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null')
    expect(await response.json()).toMatchObject({
      json: { items: [{ id: '5oRIcisKaxU' }], nextPage: null },
    })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it('serves the typed desktop client and opaque-origin preflight over a real local HTTP server', async () => {
    // Arrange
    fetchProvider.mockImplementation(async () =>
      Response.json({ total_pages: 1, results: [upstreamPhoto] }),
    )
    const server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const request = new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method,
        headers,
        body: incoming.method === 'POST' ? Buffer.concat(chunks) : undefined,
      })
      const response =
        incoming.method === 'OPTIONS'
          ? await OPTIONS(request)
          : await POST(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Local HTTP listener did not open')
    const origin = `http://127.0.0.1:${address.port}`
    const desktopClient = createORPCClient<UnsplashClient>(
      new RPCLink({
        url: `${origin}/api/rpc`,
        headers: { Origin: 'null' },
        fetch: (request) => fetchOverHttp(request),
      }),
    )
    try {
      // Act
      const preflight = await fetchOverHttp(
        `${origin}/api/rpc/unsplash/search`,
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'null',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
          },
        },
      )
      const result = await desktopClient.unsplash.search({
        query: 'lake',
        page: 1,
      })
      // Assert
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('null')
      expect(result.items[0]?.photographer.name).toBe('Mike Petrucci')
      expect(result.nextPage).toBeNull()
      expect(JSON.stringify(result)).not.toContain('unit-test-server-key')
      expect(fetchProvider).toHaveBeenCalledTimes(1)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
