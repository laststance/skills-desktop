import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { resolve } from 'node:path'

import { test, expect, _electron } from '@playwright/test'

import {
  UPDATE_DETECTION_ADVERTISED_VERSION,
  UPDATE_DETECTION_CURRENT_VERSION,
  UPDATE_DETECTION_FEED_HOST,
} from '../constants'
import {
  createIsolatedHome,
  destroyIsolatedHome,
} from '../fixtures/isolated-home'

/**
 * Channel file name electron-updater GETs on macOS (channel "latest" + the
 * darwin "-mac" suffix + ".yml"). The fake feed server matches any request
 * whose pathname ends with this, ignoring the no-cache query string that
 * electron-updater appends.
 */
const MAC_CHANNEL_FILE = 'latest-mac.yml'

/**
 * Minimal valid `latest-mac.yml` advertising a version far higher than any real
 * release. Only `version` gates the availability decision; `files`/`sha512`/`size`
 * are download-time fields and are never validated during detection (the spec
 * disables auto-download, so the artifact is never fetched). The advertised
 * version is interpolated from the shared constant so the feed and the final
 * assertion can never drift.
 */
const LATEST_MAC_YML = `version: ${UPDATE_DETECTION_ADVERTISED_VERSION}
files:
  - url: skills-desktop-${UPDATE_DETECTION_ADVERTISED_VERSION}-arm64-mac.zip
    sha512: AdummyBase64Sha512ForTestOnlyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
    size: 12345678
path: skills-desktop-${UPDATE_DETECTION_ADVERTISED_VERSION}-arm64-mac.zip
sha512: AdummyBase64Sha512ForTestOnlyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
releaseDate: '2026-06-13T00:00:00.000Z'
`

/**
 * Shape of the `update` Redux slice the spec polls. Narrowed inline (the
 * canonical slice type lives in the renderer bundle, which the spec does not
 * import) — only the two fields the assertion reads are declared.
 */
interface UpdateSliceState {
  status: string
  version: string | null
}

/**
 * Start a localhost generic update feed that serves the fake `latest-mac.yml`
 * on an EPHEMERAL port (the repo has documented port-sticking pain, so the port
 * is never hardcoded). Any path that is not the channel file returns 404 so a
 * stray artifact request fails loudly rather than silently succeeding.
 *
 * @returns The listening server plus its `http://127.0.0.1:<port>` base URL.
 * @example
 * const { server, feedUrl } = await startUpdateFeed()
 * // GET `${feedUrl}/latest-mac.yml` -> the yml; everything else -> 404
 */
async function startUpdateFeed(): Promise<{ server: Server; feedUrl: string }> {
  const server = createServer((request, response) => {
    // Match on pathname only: electron-updater appends a `?noCache=...` query,
    // so an exact `req.url === '/latest-mac.yml'` comparison would 404.
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${UPDATE_DETECTION_FEED_HOST}`,
    )
    if (requestUrl.pathname.endsWith(MAC_CHANNEL_FILE)) {
      response.writeHead(200, { 'Content-Type': 'text/yaml' })
      response.end(LATEST_MAC_YML)
      return
    }
    // Detection-only: the artifact zip must never be requested. A 404 here keeps
    // the test honest if a download is ever accidentally triggered.
    response.writeHead(404)
    response.end()
  })

  await new Promise<void>((resolveListen) => {
    server.listen(0, UPDATE_DETECTION_FEED_HOST, resolveListen)
  })

  // listen(0) assigns a free port; AddressInfo carries it once listening.
  const { port } = server.address() as AddressInfo
  return {
    server,
    feedUrl: `http://${UPDATE_DETECTION_FEED_HOST}:${port}`,
  }
}

/** Close the feed server, resolving once the socket is fully released. */
async function stopUpdateFeed(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((closeError) => {
      if (closeError) rejectClose(closeError)
      else resolveClose()
    })
  })
}

test('surfaces an available update when the release feed advertises a newer version', async () => {
  // Arrange — bring up a localhost feed advertising a high version and an
  // isolated HOME so the real userData/HOME is never touched.
  const isolatedHome = createIsolatedHome()
  const { server, feedUrl } = await startUpdateFeed()
  const repoRoot = resolve(__dirname, '..', '..')
  const mainEntry = resolve(repoRoot, 'out', 'main', 'index.mjs')

  const electronApp = await _electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      HOME: isolatedHome,
      E2E_USERDATA_DIR: resolve(isolatedHome, 'userData'),
      E2E_BACKGROUND_LAUNCH: '1',
      // Drives the test-only updater seam at the localhost feed. NOT setting
      // E2E_DISABLE_UPDATE: this spec WANTS the updater active.
      E2E_UPDATE_FEED_URL: feedUrl,
      E2E_UPDATE_CURRENT_VERSION: UPDATE_DETECTION_CURRENT_VERSION,
    },
  })

  try {
    // Act — wait for the renderer to mount, then let the detection result land
    // in Redux. The main process fires one check immediately, but that can race
    // the renderer's IPC subscription (webContents.send does not buffer for a
    // not-yet-attached listener). Re-triggering a fresh check each poll tick
    // self-heals a dropped first event; the 500ms interval guarantees each tick
    // is a completed (non-deduped) check.
    const appWindow = await electronApp.firstWindow()
    await appWindow.waitForLoadState('domcontentloaded')

    try {
      await appWindow.waitForFunction(
        () => {
          const reduxState = window.__store__?.getState() as
            | { update?: { status?: string } }
            | undefined
          if (reduxState?.update?.status === 'available') return true
          // Nudge a fresh check; by now the renderer is subscribed so the
          // re-emitted update-available reaches Redux. The `update` channel is
          // not declared on the shared e2e `electron` surface, so it is typed
          // via a local intersection cast — the call exists at runtime because
          // the preload exposes `window.electron.update.check` unconditionally.
          void (
            window.electron as typeof window.electron & {
              update: { check: () => Promise<unknown> }
            }
          ).update.check()
          return false
        },
        undefined,
        { timeout: 15_000, polling: 500 },
      )
    } catch (timeoutError) {
      // Surface the final slice state so a real failure is legible instead of a
      // bare timeout: status:'error' + message => feed/config issue; stuck
      // 'idle' => the IPC event never landed.
      const finalUpdate = await appWindow.evaluate(
        () => (window.__store__?.getState() as { update?: unknown })?.update,
      )
      throw new Error(
        `update never reached "available"; final state=${JSON.stringify(
          finalUpdate,
        )} (${String(timeoutError)})`,
      )
    }

    // Assert — the slice reflects the version the feed advertised.
    const finalUpdate = await appWindow.evaluate(
      () =>
        (window.__store__?.getState() as { update: UpdateSliceState }).update,
    )
    expect(
      finalUpdate.status,
      'detecting a newer feed version should move the update slice to "available"',
    ).toBe('available')
    expect(
      finalUpdate.version,
      'the available version should match the version advertised by the feed',
    ).toBe(UPDATE_DETECTION_ADVERTISED_VERSION)
  } finally {
    await electronApp.close()
    await stopUpdateFeed(server)
    destroyIsolatedHome(isolatedHome)
  }
})
