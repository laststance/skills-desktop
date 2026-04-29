import { ExternalLink } from 'lucide-react'
import React from 'react'

import type { HttpUrl, RepositoryId } from '../../../../shared/types'
import { useAppDispatch } from '../../redux/hooks'
import { setSelectedSource } from '../../redux/slices/uiSlice'

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
 *             repository (dispatches `setSelectedSource`) and a separate
 *             `<a target="_blank">` whose icon opens the repository on GitHub.
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
export const SourceLink = React.memo(function SourceLink({
  source,
  sourceUrl,
}: SourceLinkProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const model = getSourceLinkModel(source, sourceUrl)

  if (model.kind === 'local') {
    return (
      <span className="text-sm text-muted-foreground/70 mb-2 block">Local</span>
    )
  }

  if (model.kind === 'text') {
    return (
      <span className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-2">
        {model.source}
      </span>
    )
  }

  // Stop both clicks from reaching the surrounding `<Card>`'s onClick — that
  // would silently toggle skill selection when the user just wanted to filter
  // or open the repository.
  const handleFilterClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    event.stopPropagation()
    dispatch(setSelectedSource(model.source))
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
        aria-label={`Filter skills by repository ${model.source}`}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {model.source}
      </button>
      <a
        href={model.href}
        target="_blank"
        rel="noreferrer"
        onClick={handleExternalClick}
        aria-label={`Open ${model.source} on GitHub`}
        className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  )
})
