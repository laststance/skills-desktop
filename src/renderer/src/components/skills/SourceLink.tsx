import { ExternalLink } from 'lucide-react'
import React from 'react'
import { match } from 'ts-pattern'

import { useAppDispatch } from '@/renderer/src/redux/hooks'
import { setSelectedSources } from '@/renderer/src/redux/slices/uiSlice'
import type { HttpUrl, RepositoryId } from '@/shared/types'

import { getSourceLinkModel } from './sourceLinkHelpers'

interface SourceLinkProps {
  source?: RepositoryId
  sourceUrl?: HttpUrl
}

/**
 * Display skill source. Three render modes from `getSourceLinkModel`:
 * - `local` — "Local" label, no interactive affordance.
 * - `text`  — source identifier, plain text (no URL to link to).
 * - `link`  — split affordances: a `<button>` that filters the skill list by
 *             repository (dispatches `setSelectedSources([source])`, replacing
 *             any active repo filter) and a separate `<a target="_blank">`
 *             whose icon opens the repository on GitHub.
 *
 * Why split the `link` mode? Mixing a Redux-dispatch action and an external
 * navigation under one `<a>` was ambiguous — clicking the repo text used to
 * navigate away when the user often just wanted to narrow the list. The
 * split puts each affordance under its semantic element (`<button>` for
 * in-app actions, `<a>` for navigation) and gives each its own keyboard
 * focus stop.
 *
 * Both interactive elements stop event propagation so they do not bubble to
 * the surrounding `<Card>`'s click handler, which would otherwise toggle
 * skill selection silently when the user just wanted to filter or open a link.
 *
 * @param source - Short source identifier, e.g. "pbakaus/impeccable"
 * @param sourceUrl - Full URL to repository, e.g. "https://github.com/pbakaus/impeccable.git"
 * @example
 * <SourceLink source={repositoryId('pbakaus/impeccable')} sourceUrl="https://github.com/pbakaus/impeccable.git" />
 * // => filter button (repo text) + external-link icon (anchor)
 * <SourceLink />
 * // => "Local" label
 */
export const SourceLink = function SourceLink({
  source,
  sourceUrl,
}: SourceLinkProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const model = getSourceLinkModel(source, sourceUrl)

  // SourceLinkModel has three render modes; new modes must add explicit JSX here.
  return match(model)
    .with({ kind: 'local' }, () => (
      <span className="text-sm text-muted-foreground/70 mb-2 block">Local</span>
    ))
    .with({ kind: 'text' }, ({ source }) => (
      <span className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-2">
        {source}
      </span>
    ))
    .with({ kind: 'link' }, ({ href, source }) => {
      // Stop both clicks from reaching the surrounding `<Card>`'s onClick so
      // filtering/opening a repository never toggles skill selection.
      const handleFilterClick = (
        event: React.MouseEvent<HTMLButtonElement>,
      ): void => {
        event.stopPropagation()
        // Replace active repo filters with this focused "show me this repo"
        // jump, rather than adding another filter to the existing selection.
        dispatch(setSelectedSources([source]))
      }

      const handleExternalClick = (
        event: React.MouseEvent<HTMLAnchorElement>,
      ): void => {
        event.stopPropagation()
      }

      return (
        <span className="inline-flex items-center gap-1 mb-2">
          <button
            type="button"
            onClick={handleFilterClick}
            aria-label={`Filter skills by repository ${source}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {source}
          </button>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={handleExternalClick}
            aria-label={`Open ${source} on GitHub`}
            className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      )
    })
    .exhaustive()
}
