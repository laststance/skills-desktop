import * as TabsPrimitive from '@radix-ui/react-tabs'
import { FileCode, FileImage, FileText } from 'lucide-react'
import React from 'react'

import type { AbsolutePath, SkillFile } from '../../../../shared/types'
import { cn } from '../../lib/utils'

interface FileTabsProps {
  /** Pre-sorted list of previewable files (SKILL.md first, then alphabetical). */
  files: SkillFile[]
  /** Absolute path of the currently selected file, or null if none is active. */
  activeFilePath: AbsolutePath | null
}

/**
 * Horizontal scrollable tab list above the file preview.
 * Each tab shows the file's `relativePath`, so nested entries like
 * `workflows/run.md` remain distinguishable from a root-level `run.md`.
 * Overflow scrolls horizontally; the scrollbar chrome is hidden to keep the
 * bar visually quiet on skills with few files.
 *
 * Uses Radix Tabs primitives (`List` + `Trigger`) to get the WAI-ARIA tabs
 * pattern for free — roving tabindex, ArrowLeft/Right nav, Home/End,
 * `role="tab"` + `aria-selected` — without re-implementing any of it. Radix's
 * default `activationMode="automatic"` means arrow-key focus *is* a
 * selection; rapid scrubbing through tabs exercises the race guard in
 * `useCodePreview`.
 *
 * `TabsPrimitive.Root` lives in the parent (`CodePreview`) so the matching
 * `TabsPrimitive.Content` can share the same Root context and be associated
 * via `aria-labelledby`. Selection is reported to the parent through Root's
 * `onValueChange`; this component only renders the list.
 */
export const FileTabs = React.memo(function FileTabs({
  files,
  activeFilePath,
}: FileTabsProps): React.ReactElement {
  return (
    <TabsPrimitive.List className="shrink-0 flex items-stretch min-w-max overflow-x-auto border-b border-border bg-muted/30 scrollbar-none">
      {files.map((file) => (
        <FileTab
          key={file.path}
          file={file}
          isActive={file.path === activeFilePath}
        />
      ))}
    </TabsPrimitive.List>
  )
})

interface FileTabProps {
  file: SkillFile
  isActive: boolean
}

const FileTab = React.memo(function FileTab({
  file,
  isActive,
}: FileTabProps): React.ReactElement {
  const Icon = iconForFile(file)

  return (
    <TabsPrimitive.Trigger
      value={file.path}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-r border-border/60 whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        isActive
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 opacity-80" />
      <span className="max-w-[240px] truncate">{file.relativePath}</span>
      {isActive && (
        <span
          className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
          aria-hidden
        />
      )}
    </TabsPrimitive.Trigger>
  )
})

function iconForFile(file: SkillFile): typeof FileText {
  if (file.previewable === 'image') return FileImage
  if (file.extension === '.md' || file.extension === '.mdx') return FileText
  return FileCode
}
