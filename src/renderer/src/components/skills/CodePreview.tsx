import * as TabsPrimitive from '@radix-ui/react-tabs'
import { FolderX } from 'lucide-react'
import React from 'react'

import { useCodePreview } from '@/renderer/src/hooks/useCodePreview'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectPreviewAppearanceSettings } from '@/renderer/src/redux/slices/settingsSlice'
import type { AbsolutePath } from '@/shared/types'

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
    setActiveFile(next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading files...
      </div>
    )
  }

  // Ordered before the empty state on purpose: a failed list leaves `files`
  // empty, so without this the pane would claim the skill simply has no
  // previewable files instead of admitting it could not read them.
  if (loadFailed) {
    return <FilesUnavailableNotice />
  }

  // Guards the value the tabs actually read, and it is equivalent to guarding
  // on `files.length === 0` in both directions. Forward: {@link useCodePreview}
  // computes `activeFile` as `userSelectedFile ?? files[0]?.path ?? null`, so
  // `!activeFile` needs an empty list. Reverse: `setActiveFile` drops any path
  // absent from `files` before it commits, and the render-phase reset nulls
  // `userSelectedFile` on every `skillPath` change -- so a selection can never
  // outlive the list it came from.
  if (!activeFile) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No preview files found
      </div>
    )
  }

  return (
    <TabsPrimitive.Root
      value={activeFile}
      onValueChange={handleValueChange}
      className="flex flex-col h-full"
    >
      <FileTabs files={files} activeFilePath={activeFile} />
      <TabsPrimitive.Content
        value={activeFile}
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
  )
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
