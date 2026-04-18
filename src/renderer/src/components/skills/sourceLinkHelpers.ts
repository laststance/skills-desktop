import type { HttpUrl, RepositoryId } from '../../../../shared/types'

/**
 * Discriminated render model for `SourceLink`.
 * - `local`  — no source identifier; render the "Local" label
 * - `text`   — identifier present but no URL; render as plain text
 * - `link`   — identifier and URL present; render as an external anchor
 */
export type SourceLinkModel =
  | { kind: 'local' }
  | { kind: 'text'; source: RepositoryId }
  | { kind: 'link'; source: RepositoryId; href: HttpUrl }

/**
 * Compute the render model for `SourceLink` from its props.
 *
 * Strips a trailing `.git` suffix from `sourceUrl` so GitHub web URLs work
 * when the source was a clone URL.
 *
 * @param source - Short source identifier, e.g. "pbakaus/impeccable"
 * @param sourceUrl - Full URL to repository, e.g. "https://github.com/pbakaus/impeccable.git"
 * @returns
 * - `{ kind: 'local' }` when `source` is missing
 * - `{ kind: 'text', source }` when `source` exists but `sourceUrl` is missing
 * - `{ kind: 'link', source, href }` when both are present (href is `.git`-stripped)
 * @example
 * getSourceLinkModel()
 * // => { kind: 'local' }
 * @example
 * getSourceLinkModel('pbakaus/impeccable')
 * // => { kind: 'text', source: 'pbakaus/impeccable' }
 * @example
 * getSourceLinkModel('pbakaus/impeccable', 'https://github.com/pbakaus/impeccable.git')
 * // => { kind: 'link', source: 'pbakaus/impeccable', href: 'https://github.com/pbakaus/impeccable' }
 */
export function getSourceLinkModel(
  source?: RepositoryId,
  sourceUrl?: HttpUrl,
): SourceLinkModel {
  if (!source) return { kind: 'local' }
  const href = sourceUrl ? sourceUrl.replace(/\.git$/, '') : undefined
  if (!href) return { kind: 'text', source }
  return { kind: 'link', source, href }
}
