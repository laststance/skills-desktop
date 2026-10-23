import * as TabsPrimitive from '@radix-ui/react-tabs'
import { FolderX } from 'lucide-react'
import React from 'react'
import { match } from 'ts-pattern'

import { useCodePreview } from '@/renderer/src/hooks/useCodePreview'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectPreviewAppearanceSettings } from '@/renderer/src/redux/slices/settingsSlice'
import type { SkillFilesCode } from '@/shared/skillFiles'
import type { AbsolutePath } from '@/shared/types'
import { toAbsolutePath } from '@/shared/types'

import { resolvePreviewPaneState } from './codePreviewHelpers'
import { FileContent } from './FileContent'
import { FileTabs } from './FileTabs'

interface CodePreviewProps {
  skillPath: AbsolutePath
}

/**
 * Right-pane preview for the selected skill.
 * Layout is a vertical stack: a horizontal tab bar on top, then the file
 * preview fills the remaining height. This replaces the earlier tree-sidebar
 * layout, which wasted ~70% of its pane as blank space on skills with only a
 * handful of files.
 *
 * `TabsPrimitive.Root` wraps both the tab list AND the preview pane so Radix
 * can associate the active `<TabsPrimitive.Trigger>` (role="tab") with the
 * `<TabsPrimitive.Content>` (role="tabpanel") via `aria-labelledby`. Keeping
 * Root here — rather than inside `FileTabs` — is what makes the panel
 * discoverable to assistive tech.
 *
 * FileContent owns the actual rendering mode: source-like files get Shiki
 * syntax highlighting, and Markdown can switch into a rendered reading view.
 */
export const CodePreview = function CodePreview({
  skillPath,
}: CodePreviewProps): React.ReactElement {
  const {
    files,
    activeFile,
    setActiveFile,
    content,
    loading,
    loadFailed,
    reading,
    retry,
    listing,
  } = useCodePreview(skillPath)
  // Preview typography is user-configurable in Settings → Appearance; this is
  // the single Redux read that feeds the otherwise-presentational FileContent.
  const { markdownFontSizePx, codeFontSizePx, codeThemeId } = useAppSelector(
    selectPreviewAppearanceSettings,
  )

  const handleValueChange = (next: string): void => {
    /* v8 ignore next -- next is always a non-empty file.path: Radix emits a Trigger's own value and every FileTabs Trigger has value={file.path} (non-empty AbsolutePath); Root has no collapsible/deselect prop, so next === '' never occurs */
    if (!next) return
    // Fire-and-forget by design: {@link useCodePreview} owns the loading and
    // failure states, and its `setActiveFile` degrades a failed read to the
    // empty pane rather than rejecting. `void` pins that at the call site so a
    // future rejection is a visible change here, not a silently dropped one.
    void setActiveFile(toAbsolutePath(next))
  }

  // Exhaustive over PreviewPaneState: the priority order between these four
  // panes lives in {@link resolvePreviewPaneState} and is asserted there
  // without React, and a future pane added to the union fails compilation here
  // instead of silently never rendering.
  return match(resolvePreviewPaneState({ loading, loadFailed, activeFile }))
    .with({ kind: 'loading' }, () => (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading files...
      </div>
    ))
    .with({ kind: 'unavailable' }, () => (
      <FilesUnavailableNotice retry={retry} code={listing?.code} />
    ))
    .with({ kind: 'empty' }, () => (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No preview files found
      </div>
    ))
    .with({ kind: 'ready' }, ({ activeFile: activeFilePath }) => (
      <TabsPrimitive.Root
        value={activeFilePath}
        onValueChange={handleValueChange}
        className="flex flex-col h-full"
      >
        {listing?.status === 'partial' && (
          <div
            role="status"
            className="px-3 py-1 text-xs text-muted-foreground"
          >
            Some files could not be listed.{' '}
            {listing.code ||
            listing.issues.some(
              (issue) =>
                issue.code !== 'depth' &&
                issue.code !== 'limit' &&
                issue.code !== 'denied',
            ) ? (
              <FileRecoveryAction retry={retry} code={listing.code} />
            ) : null}
          </div>
        )}
        <FileTabs files={files} activeFilePath={activeFilePath} />
        <TabsPrimitive.Content
          value={activeFilePath}
          className="flex-1 flex flex-col min-h-0 focus-visible:outline-none"
        >
          {reading ? (
            <div role="status" className="p-4 text-sm text-muted-foreground">
              Loading preview…
            </div>
          ) : content.kind === 'error' ? (
            <div role="alert" className="p-4 text-sm text-muted-foreground">
              {content.code === 'missing'
                ? 'This file is no longer available. Rescan skills to refresh the list.'
                : content.code === 'limit'
                  ? 'This file exceeds the preview size limit.'
                  : 'This file could not be read.'}
              <FileRecoveryAction retry={retry} code={content.code} />
            </div>
          ) : (
            <FileContent
              content={content}
              markdownFontSizePx={markdownFontSizePx}
              codeFontSizePx={codeFontSizePx}
              codeThemeId={codeThemeId}
            />
          )}
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    ))
    .exhaustive()
}

/**
 * Terminal-failure state for the Files tab when the file list could not be read.
 * Takes the fuller icon + heading + description treatment DESIGN.md reserves for
 * real failures, unlike the quiet one-liner used for the expected "skill has no
 * previewable files" empty. Amber is the app-wide inaccessible-status hue, so
 * this adds no new colour semantic. @see DESIGN.md "Empty States"
 */
const FilesUnavailableNotice = function FilesUnavailableNotice({
  retry,
  code,
}: {
  retry: () => void
  code?: SkillFilesCode
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <FolderX className="size-10 text-amber-400 mb-3" aria-hidden />
      <h3 className="text-sm font-medium text-foreground mb-1">
        Cannot read this skill&apos;s files
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs">
        The folder may be missing, inaccessible, or outside the allowed skill
        directories. The Info tab shows its location.
      </p>
      <FileRecoveryAction retry={retry} code={code} />
    </div>
  )
}

/** Offers recovery only when it can change the outcome of a listing or content failure.
 * @example <FileRecoveryAction code="missing" retry={retry} />
 */
function FileRecoveryAction({
  code,
  retry,
}: {
  code?: SkillFilesCode
  retry: () => void
}): React.ReactElement | null {
  if (code === 'denied' || code === 'limit') return null
  return (
    <button
      type="button"
      onClick={retry}
      className="ml-2 min-h-6 text-sm text-primary"
    >
      {code === 'missing' ? 'Rescan skills' : 'Retry'}
    </button>
  )
}
