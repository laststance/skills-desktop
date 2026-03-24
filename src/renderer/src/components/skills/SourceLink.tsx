import { ExternalLink } from 'lucide-react'
import React from 'react'

interface SourceLinkProps {
  source?: string
  sourceUrl?: string
}

/**
 * Display skill source as a clickable external link or "Local" label
 * @param source - Short source identifier, e.g. "pbakaus/impeccable"
 * @param sourceUrl - Full URL to repository, e.g. "https://github.com/pbakaus/impeccable.git"
 * @example
 * <SourceLink source="pbakaus/impeccable" sourceUrl="https://github.com/pbakaus/impeccable.git" />
 * // => clickable "pbakaus/impeccable ↗" link
 * <SourceLink />
 * // => "Local" text
 */
export const SourceLink = React.memo(function SourceLink({
  source,
  sourceUrl,
}: SourceLinkProps): React.ReactElement {
  if (!source) {
    return (
      <span className="text-sm text-muted-foreground/70 mb-2 block">Local</span>
    )
  }

  const href = sourceUrl ? sourceUrl.replace(/\.git$/, '') : undefined

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (href) {
          window.electron.shell.openExternal(href)
        }
      }}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-2"
    >
      {source}
      <ExternalLink className="h-3 w-3" />
    </button>
  )
})
