import { match } from 'ts-pattern'

import type { BackgroundApplySource } from '@/shared/backgrounds'

/** Identifies gallery selections and virtual focus by source identity, independent of row position.
 * @returns Stable source-prefixed key, or empty string for no selection.
 * @example backgroundSourceKey({ kind: 'builtin', builtinId: 'alpine-lake' }) // 'builtin:alpine-lake'
 */
export function backgroundSourceKey(
  source: BackgroundApplySource | null | undefined,
): string {
  if (!source) return ''
  return match(source)
    .with({ kind: 'builtin' }, ({ builtinId }) => `builtin:${builtinId}`)
    .with({ kind: 'upload' }, ({ uploadId }) => `upload:${uploadId}`)
    .with({ kind: 'upload-draft' }, ({ draftId }) => `draft:${draftId}`)
    .with({ kind: 'unsplash' }, ({ photo }) => `unsplash:${photo.id}`)
    .exhaustive()
}
