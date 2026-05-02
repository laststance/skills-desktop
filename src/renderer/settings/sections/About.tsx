import { ExternalLink } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { match } from 'ts-pattern'

import { SKILLS_DESKTOP_REPOSITORY_URL } from '../../../shared/constants'
import { Button } from '../../src/components/ui/button'
import { Separator } from '../../src/components/ui/separator'

import { SectionFrame } from './SectionFrame'

const RELEASES_URL = `${SKILLS_DESKTOP_REPOSITORY_URL}/releases`
const LICENSE_URL = 'https://opensource.org/licenses/MIT'

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'error'; message: string }

/**
 * Inline status text shown under the "Check for Updates" button.
 *
 * Settings subscribes to the same updater events the main window listens
 * for (via `window.electron.update.*`). We need local state because the
 * Settings store does NOT include the `update` slice — keeping that
 * slice main-window-only avoids a second update Redux pipeline that
 * would only differ from the existing one to drive a four-line status
 * line.
 */
function statusLabel(status: CheckStatus): string {
  return match(status)
    .with({ kind: 'idle' }, () => '')
    .with({ kind: 'checking' }, () => 'Checking for updates…')
    .with({ kind: 'up-to-date' }, () => 'Skills Desktop is up to date.')
    .with(
      { kind: 'available' },
      ({ version }) => `Update available: v${version}. See the main window.`,
    )
    .with({ kind: 'error' }, ({ message }) => `Update check failed: ${message}`)
    .exhaustive()
}

/**
 * About pane.
 *
 * Real surfaces (v0.15.0):
 *  - App version from `__APP_VERSION__` (Vite define injecting
 *    `package.json#version`).
 *  - "Check for Updates" calls the existing `update:check` IPC and
 *    listens for the `update:checking` / `update:not-available` /
 *    `update:available` / `update:error` events to render inline status.
 *  - Repo / Releases / MIT links use native `<a target="_blank">` so
 *    `setWindowOpenHandler` routes them to the system browser via
 *    `shell.openExternal` (see feedback_external_links memory).
 *
 * Note: in dev, `window.electron.update` is always exposed by preload
 * but `initAutoUpdater()` only runs when `app.isPackaged`. A click
 * therefore fires `update:check` into a process with no autoUpdater
 * listeners, so no `update:checking` / `update:not-available` event
 * comes back and the button gets stuck on "Checking…". Accepted as
 * dev-only cosmetic noise — gating would require plumbing
 * `app.isPackaged` through a Vite `define` or extra IPC, which costs
 * more in dev/prod branching than it saves.
 */
export const About = React.memo(function About(): React.ReactElement {
  const updateApi = window.electron.update
  const isUpdaterAvailable = Boolean(updateApi)
  const [checkStatus, setCheckStatus] = useState<CheckStatus>({ kind: 'idle' })

  useEffect(() => {
    if (!updateApi) return
    const cleanups = [
      updateApi.onChecking(() => setCheckStatus({ kind: 'checking' })),
      updateApi.onAvailable((info) =>
        setCheckStatus({ kind: 'available', version: info.version }),
      ),
      updateApi.onNotAvailable(() => setCheckStatus({ kind: 'up-to-date' })),
      updateApi.onError((error) =>
        setCheckStatus({ kind: 'error', message: error.message }),
      ),
    ]
    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [updateApi])

  const handleCheckForUpdates = (): void => {
    if (!updateApi) return
    setCheckStatus({ kind: 'checking' })
    void updateApi.check()
  }

  const status = statusLabel(checkStatus)

  return (
    <SectionFrame title="About">
      <div className="flex flex-col items-start gap-1">
        <h2 className="text-lg font-semibold">Skills Desktop</h2>
        <p className="text-sm text-muted-foreground">
          Version {__APP_VERSION__}
        </p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleCheckForUpdates}
          disabled={!isUpdaterAvailable || checkStatus.kind === 'checking'}
        >
          Check for Updates
        </Button>
        {!isUpdaterAvailable && (
          <p className="text-xs text-muted-foreground">
            Auto-updates are disabled in development builds.
          </p>
        )}
        {status && (
          <p
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        )}
      </div>

      <Separator />

      <ul className="flex flex-col gap-2 text-sm">
        <li>
          <a
            href={SKILLS_DESKTOP_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <span>GitHub repository</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </li>
        <li>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <span>Releases</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </li>
        <li>
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <span>License (MIT)</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </li>
      </ul>
    </SectionFrame>
  )
})
