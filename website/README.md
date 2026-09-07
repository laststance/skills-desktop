# Skills Desktop website and Unsplash proxy

The landing page and the desktop gallery's shared API deploy together as a Next.js application. The API is a Node Route Handler at `/api/rpc/[...rest]`; static-export hosting does not run this route.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

The public, server-free contract is `src/lib/unsplash-contract.ts`. Electron Main uses `unsplash.trackDownload`; Settings uses `unsplash.search` through oRPC 1.15.0 and `@orpc/tanstack-query`. Server implementation stays in `src/server/unsplash.ts` and is imported only by the Route Handler.

## Provider configuration

Set `UNSPLASH_ACCESS_KEY` in the Laststance Vercel team's `skills-desktop` project environment. Local development may use an ignored `.env.local`. Never use a `NEXT_PUBLIC_` prefix or place credentials in the desktop application. The API returns a recoverable `UNAVAILABLE` response when no key is configured; built-in images and uploads remain usable.

Use the Vercel project root `website`, the Next.js framework preset and its default output. Production RPC URL: `https://skills-desktop.vercel.app/api/rpc`. Enter credentials through provider configuration; commands, screenshots, logs and pull requests must not contain key values.

The deployment gate includes an Unsplash application registration, configured access key, production approval/quota verification and a real search/credit/download-notification smoke test. [Unsplash documents application registration, quota and attribution requirements](https://unsplash.com/documentation).

## Request and cache behavior

- POST carries the two oRPC procedures. OPTIONS supports preflight. Browser origins are the current Website deployment, literal `null` for packaged Electron, and explicit HTTP loopback origins (`localhost`, `127.0.0.1`, `[::1]`) for development. Cookies and credentialed CORS are not enabled. CORS is not authentication.
- Requests have an 8 KiB body and URL limit. Provider JSON has a 2 MiB actual-byte limit and a 10-second deadline. The credentialed fetch destination is always `api.unsplash.com`; redirects are rejected without a second request.
- Search is capped at 30 photos/page and page 1,000. Only successfully validated metadata enters Next's shared Data Cache, with 60-second revalidation. Errors do not enter the cache. The public HTTP response remains `no-store`.
- Download notifications use the validated exact photo endpoint and never use the cache or retry automatically. A timeout or malformed acknowledgement reports uncertainty: the provider may already have recorded the action. Its returned URL is validated as an HTTPS acknowledgement field and is never fetched, rendered or returned to clients. [The endpoint is an event notification, not an image-delivery API](https://unsplash.com/documentation#track-a-photo-download).
- Image URLs remain direct Unsplash CDN hotlinks with `ixid`. Photo and photographer links add `utm_source=skills-desktop&utm_medium=referral`; gallery and main-window rendering own the visible credits.

## Hosting rate enforcement and live verification

The Laststance Vercel project's hosting firewall owns per-IP enforcement for `/api/rpc/`; no process-local rate counter exists. On 2026-09-08 JST, integration configured a fixed 60-request/60-second window and verified it with 63 real HEAD requests: 60 reached the then-undeployed route (404), then three were limited (429). No Unsplash calls were involved. Keep the rule enabled before deploying a configured proxy and preserve unrelated firewall rules.

Hosting-generated 429 responses currently have neither `Retry-After` nor CORS headers. A cross-origin browser can therefore report a generic network failure for that response; do not invent a quota reset time. Provider-generated quota errors reaching the application use typed `RATE_LIMITED`, with a reset interval only when the provider supplies one.

Automated tests run the actual oRPC client/handler, Next IncrementalCache (including 60-second revalidation and failed-search exclusion), bounded streams and a real local HTTP server. These tests use a fake provider fetch; they do not establish live-provider approval or deployment success. Before declaring the online feature complete, record a production request, correct credits/hotlinks, one intended download notification, configured quota and packaged Electron CORS/CSP behavior.
