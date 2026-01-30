import { Download, RefreshCw, X, AlertCircle } from 'lucide-react'

import { downloadUpdate, installUpdate } from '../hooks/useUpdateNotification'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../redux/hooks'
import { dismiss, setDownloading } from '../redux/slices/updateSlice'

import { Button } from './ui/button'

/**
 * Toast notification for auto-update status
 * Displays in bottom-right corner, shows progress during download
 */
export function UpdateToast(): React.ReactElement | null {
  const dispatch = useAppDispatch()
  const { status, version, progress, error, dismissed } = useAppSelector(
    (state) => state.update,
  )

  // Don't show if dismissed or no update activity
  if (dismissed || status === 'idle' || status === 'checking') {
    return null
  }

  const handleDownload = async () => {
    dispatch(setDownloading())
    await downloadUpdate()
  }

  const handleInstall = async () => {
    await installUpdate()
  }

  const handleDismiss = () => {
    dispatch(dismiss())
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 w-80',
        'bg-card border border-border rounded-lg shadow-lg',
        'animate-in slide-in-from-bottom-4 fade-in duration-300',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          {status === 'error' ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : status === 'ready' ? (
            <RefreshCw className="h-4 w-4 text-primary" />
          ) : (
            <Download className="h-4 w-4 text-primary" />
          )}
          <span className="font-medium text-sm">
            {status === 'available' && 'Update Available'}
            {status === 'downloading' && 'Downloading Update'}
            {status === 'ready' && 'Update Ready'}
            {status === 'error' && 'Update Error'}
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-3">
        {status === 'error' ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {status === 'available' &&
              `Version ${version} is available. Download now?`}
            {status === 'downloading' && `Downloading version ${version}...`}
            {status === 'ready' &&
              `Version ${version} is ready to install. Restart to apply update.`}
          </p>
        )}

        {/* Progress Bar */}
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

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-3">
          {status === 'available' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Later
              </Button>
              <Button size="sm" onClick={handleDownload}>
                Download
              </Button>
            </>
          )}
          {status === 'ready' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Later
              </Button>
              <Button size="sm" onClick={handleInstall}>
                Restart Now
              </Button>
            </>
          )}
          {status === 'error' && (
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
