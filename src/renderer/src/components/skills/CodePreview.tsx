import * as TabsPrimitive from '@radix-ui/react-tabs'
import React, { useCallback } from 'react'

import { useCodePreview } from '../../hooks/useCodePreview'

import { FileContent } from './FileContent'
import { FileTabs } from './FileTabs'

interface CodePreviewProps {
  skillPath: string
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
 * All syntax highlighting was removed on purpose: plain monospace text reads
 * fine across every language we support and keeps the renderer bundle small.
 */
export const CodePreview = React.memo(function CodePreview({
  skillPath,
}: CodePreviewProps): React.ReactElement {
  const { files, activeFile, setActiveFile, content, loading } =
    useCodePreview(skillPath)

  const handleValueChange = useCallback(
    (next: string) => {
      if (!next) return
      setActiveFile(next)
    },
    [setActiveFile],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading files...
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No preview files found
      </div>
    )
  }

  return (
    <TabsPrimitive.Root
      value={activeFile ?? ''}
      onValueChange={handleValueChange}
      className="flex flex-col h-full"
    >
      <FileTabs files={files} activeFilePath={activeFile} />
      <TabsPrimitive.Content
        value={activeFile ?? ''}
        className="flex-1 flex flex-col min-h-0 focus-visible:outline-none"
      >
        <FileContent content={content} />
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  )
})
