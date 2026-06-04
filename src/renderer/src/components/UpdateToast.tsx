import { Download, RefreshCw, X, AlertCircle } from 'lucide-react'
import React, { useCallback } from 'react'
import { match } from 'ts-pattern'

import {
  downloadUpdate,
  installUpdate,
} from '@/renderer/src/hooks/useUpdateNotification'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  dismiss,
  setDownloading,
} from '@/renderer/src/redux/slices/updateSlice'

import { Button } from './ui/button'

/**
 * Toast notification for auto-update status
 * Displays in bottom-right corner, shows progress during download
 */
export const UpdateToast = React.memo(
  function UpdateToast(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const { status, version, progress, error, dismissed } = useAppSelector(
      (state) => state.update,
    )

    const handleDownload = useCallback(async (): Promise<void> => {
      dispatch(setDownloading())
      await downloadUpdate()
    }, [dispatch])

    const handleInstall = useCallback(async (): Promise<void> => {
      await installUpdate()
    }, [])

    const handleDismiss = useCallback((): void => {
      dispatch(dismiss())
    }, [dispatch])

    // Don't show if dismissed or no update activity
    if (dismissed || status === 'idle' || status === 'checking') {
      return null
    }

    // After the guard above, `status` is narrowed to the four "visible" phases.
    // Each match() below is exhaustive over that narrowed union — adding a new
    // visible status to UpdateStatus fails compilation here instead of silently
    // rendering a half-decorated toast.
    const headerIcon = match(status)
      .with('error', () => <AlertCircle className="h-4 w-4 text-destructive" />)
      .with('ready', () => <RefreshCw className="h-4 w-4 text-primary" />)
      .with('available', 'downloading', () => (
        <Download className="h-4 w-4 text-primary" />
      ))
      .exhaustive()

    const headerTitle = match(status)
      .with('available', () => 'Update Available')
      .with('downloading', () => 'Downloading Update')
      .with('ready', () => 'Update Ready')
      .with('error', () => 'Update Error')
      .exhaustive()

    const bodyText = match(status)
      .with('error', () => error)
      .with('available', () => `Version ${version} is available. Download now?`)
      .with('downloading', () => `Downloading version ${version}...`)
      .with(
        'ready',
        () =>
          `Version ${version} is ready to install. Restart to apply update.`,
      )
      .exhaustive()

    const actions = match(status)
      .with('available', () => (
        <>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            Later
          </Button>
          <Button size="sm" onClick={handleDownload}>
            Download
          </Button>
        </>
      ))
      .with('ready', () => (
        <>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            Later
          </Button>
          <Button size="sm" onClick={handleInstall}>
            Restart Now
          </Button>
        </>
      ))
      .with('error', () => (
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          Dismiss
        </Button>
      ))
      .with('downloading', () => null)
      .exhaustive()

    return (
      <div
        className={cn(
          'fixed bottom-4 right-4 z-50 w-80',
          'bg-card border border-border rounded-lg shadow-lg',
          'animate-in slide-in-from-bottom-4 fade-in duration-300',
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            {headerIcon}
            <span className="font-medium text-sm">{headerTitle}</span>
          </div>
          <Button
            type="button"
            onClick={handleDismiss}
            variant="ghost"
            size="icon"
            className="size-7 p-0 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-3">
          <p className="text-sm text-muted-foreground">{bodyText}</p>

          {/* Progress bar — only for the downloading phase. Single-case
              check kept as `&&` per project rule (ts-pattern is for 4+ cases). */}
          {status === 'downloading' && (
            <div className="mt-3">
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1 text-right">
                {progress.toFixed(0)}%
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-3">
            {actions}
          </div>
        </div>
      </div>
    )
  },
)
