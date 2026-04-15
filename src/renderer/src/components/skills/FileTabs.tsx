import { FileCode, FileImage, FileText } from 'lucide-react'
import React from 'react'

import type { SkillFile } from '../../../../shared/types'
import { cn } from '../../lib/utils'

interface FileTabsProps {
  /** Pre-sorted list of previewable files (SKILL.md first, then alphabetical). */
  files: SkillFile[]
  /** Absolute path of the currently selected file, or null if none is active. */
  activeFilePath: string | null
  /** Invoked when the user clicks a tab. */
  onSelectAction: (file: SkillFile) => void
}

/**
 * Horizontal scrollable tab bar above the file preview.
 * Each tab shows the file's `relativePath`, so nested entries like
 * `workflows/run.md` remain distinguishable from a root-level `run.md`.
 * Overflow scrolls horizontally; the scrollbar chrome is hidden to keep the
 * bar visually quiet on skills with few files.
 */
export const FileTabs = React.memo(function FileTabs({
  files,
  activeFilePath,
  onSelectAction,
}: FileTabsProps): React.ReactElement {
  return (
    <div
      className="shrink-0 overflow-x-auto border-b border-border bg-muted/30 scrollbar-none"
      role="tablist"
    >
      <div className="flex items-stretch min-w-max">
        {files.map((file) => (
          <FileTab
            key={file.path}
            file={file}
            isActive={file.path === activeFilePath}
            onSelectAction={onSelectAction}
          />
        ))}
      </div>
    </div>
  )
})

interface FileTabProps {
  file: SkillFile
  isActive: boolean
  onSelectAction: (file: SkillFile) => void
}

const FileTab = React.memo(function FileTab({
  file,
  isActive,
  onSelectAction,
}: FileTabProps): React.ReactElement {
  const Icon = iconForFile(file)

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => onSelectAction(file)}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-r border-border/60 whitespace-nowrap transition-colors',
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
    </button>
  )
})

/**
 * Pick a lucide icon based on the file's preview kind.
 * Plain text is the most common case, so it's the default.
 */
function iconForFile(file: SkillFile): typeof FileText {
  if (file.previewable === 'image') return FileImage
  if (file.extension === '.md' || file.extension === '.mdx') return FileText
  return FileCode
}
