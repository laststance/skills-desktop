import { ExternalLink } from 'lucide-react'
import React from 'react'

interface SourceLinkProps {
  source?: string
  sourceUrl?: string
}

/**
 * Display skill source as a clickable external link or "Local" label.
 *
 * Uses a native `<a target="_blank">` which Electron intercepts via
 * `setWindowOpenHandler` (src/main/index.ts) and routes http(s) URLs to the
 * system browser through `shell.openExternal`. `stopPropagation` prevents the
 * parent Card's click handler from firing alongside the navigation.
 *
 * @param source - Short source identifier, e.g. "pbakaus/impeccable"
 * @param sourceUrl - Full URL to repository, e.g. "https://github.com/pbakaus/impeccable.git"
 * @example
 * <SourceLink source="pbakaus/impeccable" sourceUrl="https://github.com/pbakaus/impeccable.git" />
 * // => clickable "pbakaus/impeccable ↗" link that opens in the default browser
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

  if (!href) {
    return (
      <span className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-2">
        {source}
      </span>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-2"
    >
      {source}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
})
