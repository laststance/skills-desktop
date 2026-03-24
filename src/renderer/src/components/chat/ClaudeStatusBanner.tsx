import { AlertCircle, RefreshCw } from 'lucide-react'
import React from 'react'

import { Button } from '../ui/button'

interface ClaudeStatusBannerProps {
  onRetry: () => void
}

/**
 * Banner shown when Claude Code is not detected on the system
 * Provides install instructions and retry button
 */
export const ClaudeStatusBanner = React.memo(function ClaudeStatusBanner({
  onRetry,
}: ClaudeStatusBannerProps): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertCircle className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Claude Code not found
        </p>
        <p className="text-xs text-muted-foreground">
          Install with: npm install -g @anthropic-ai/claude-code
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3 w-3 mr-1" />
        Retry Detection
      </Button>
    </div>
  )
})
