import * as TabsPrimitive from '@radix-ui/react-tabs'
import { FolderX } from 'lucide-react'
import React from 'react'
import { match } from 'ts-pattern'

import { useCodePreview } from '@/renderer/src/hooks/useCodePreview'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectPreviewAppearanceSettings } from '@/renderer/src/redux/slices/settingsSlice'
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
  const { files, activeFile, setActiveFile, content, loading, loadFailed } =
    useCodePreview(skillPath)
  // Preview typography is user-configurable in Settings → Appearance; this is
  // the single Redux read that feeds the otherwise-presentational FileContent.
  const { markdownFontSizePx, codeFontSizePx, codeThemeId } = useAppSelector(
    selectPreviewAppearanceSettings,
  )

  const handleValueChange = (next: string) => {
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
    .with({ kind: 'unavailable' }, () => <FilesUnavailableNotice />)
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
        <FileTabs files={files} activeFilePath={activeFilePath} />
        <TabsPrimitive.Content
          value={activeFilePath}
          className="flex-1 flex flex-col min-h-0 focus-visible:outline-none"
        >
          <FileContent
            content={content}
            markdownFontSizePx={markdownFontSizePx}
            codeFontSizePx={codeFontSizePx}
            codeThemeId={codeThemeId}
          />
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
const FilesUnavailableNotice =
  function FilesUnavailableNotice(): React.ReactElement {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <FolderX className="size-10 text-amber-400 mb-3" aria-hidden />
        <h3 className="text-sm font-medium text-foreground mb-1">
          Cannot read this skill&apos;s files
        </h3>
        <p className="text-xs text-muted-foreground max-w-xs">
          Its folder sits outside the skill directories this app is allowed to
          read. The Info tab shows where each agent links this skill from.
        </p>
      </div>
    )
  }
