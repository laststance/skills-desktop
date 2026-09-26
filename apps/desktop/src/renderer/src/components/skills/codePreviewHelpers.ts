import type { AbsolutePath } from '@/shared/types'

/**
 * Which of {@link CodePreview}'s four mutually exclusive panes should render.
 * `ready` carries the resolved path so the caller gets a non-null
 * {@link AbsolutePath} without re-narrowing at the JSX site.
 */
export type PreviewPaneState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'ready'; activeFile: AbsolutePath }

interface PreviewPaneInput {
  /** True until the file list has been fetched for the current skill. */
  loading: boolean
  /** True when that fetch rejected, so no list exists to render. */
  loadFailed: boolean
  /** The file whose content the pane shows; null when the list is empty. */
  activeFile: AbsolutePath | null
}

/**
 * Pick the pane to render, in strict priority order, so the ordering is
 * assertable without mounting React. Exists because two of the four states are
 * reached with `activeFile === null` and would otherwise be indistinguishable:
 * a failed list leaves `files` empty exactly like a skill with nothing to
 * preview, so `unavailable` MUST outrank `empty` or a read failure gets
 * misreported as "this skill has no files".
 * @param input - The three flags {@link useCodePreview} exposes.
 * @returns
 * - `loading` while the list is in flight (outranks everything: the other flags
 *   are not yet meaningful)
 * - `unavailable` when the list rejected
 * - `empty` when the list succeeded but held no previewable file
 * - `ready` otherwise, carrying the active file's path
 * @example
 * resolvePreviewPaneState({ loading: false, loadFailed: true, activeFile: null })
 * // => { kind: 'unavailable' }
 * resolvePreviewPaneState({ loading: false, loadFailed: false, activeFile: '/s/a.md' })
 * // => { kind: 'ready', activeFile: '/s/a.md' }
 */
export function resolvePreviewPaneState({
  loading,
  loadFailed,
  activeFile,
}: PreviewPaneInput): PreviewPaneState {
  if (loading) return { kind: 'loading' }
  if (loadFailed) return { kind: 'unavailable' }
  if (!activeFile) return { kind: 'empty' }
  return { kind: 'ready', activeFile }
}
