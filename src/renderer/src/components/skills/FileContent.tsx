import { FileQuestion } from 'lucide-react'
import React from 'react'
import { match } from 'ts-pattern'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { formatBytes } from '@/shared/fileTypes'

interface FileContentProps {
  content: PreviewContent
}

/**
 * Right-panel file preview. Switches on `content.kind`:
 * - `text`   → line-numbered `<pre>` in JetBrains Mono, no syntax highlighting
 * - `image`  → centered `<img>` sourced from a base64 data URL
 * - `binary` → placeholder with filename + size
 * - `empty`  → "no file selected" placeholder
 *
 * No syntax highlighting is intentional: plain monospace + adequate line
 * height is legible across every language we list, and avoids pulling in a
 * ~200KB highlighter bundle.
 */
export const FileContent = React.memo(function FileContent({
  content,
}: FileContentProps): React.ReactElement {
  // Exhaustive over PreviewContent: a future variant added to the union (e.g.
  // a `pdf` preview) fails compilation here instead of silently falling
  // through to the text branch the way an `if`-chain would.
  return match(content)
    .with({ kind: 'empty' }, () => <EmptyState />)
    .with({ kind: 'binary' }, ({ fileName, size }) => (
      <BinaryPlaceholder fileName={fileName} size={size} />
    ))
    .with({ kind: 'image' }, ({ data }) => (
      <div className="flex-1 overflow-auto bg-muted p-6 flex items-center justify-center">
        <img
          src={data.dataUrl}
          alt={data.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    ))
    .with({ kind: 'text' }, ({ data }) => (
      <TextPreview content={data.content} />
    ))
    .exhaustive()
})

interface TextPreviewProps {
  content: string
}

const TextPreview = React.memo(function TextPreview({
  content,
}: TextPreviewProps): React.ReactElement {
  const lines = content.split('\n')
  return (
    <div className="flex-1 overflow-auto bg-muted pb-4">
      <table className="w-full text-[13px] font-mono leading-relaxed">
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} className="hover:bg-foreground/5">
              <td className="w-12 px-2 py-0.5 text-right text-muted-foreground select-none border-r border-border/50 align-top">
                {idx + 1}
              </td>
              <td className="px-3 py-0.5 whitespace-pre text-foreground">
                {line || ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

const EmptyState = React.memo(function EmptyState(): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      Select a file to preview
    </div>
  )
})

interface BinaryPlaceholderProps {
  fileName: string
  size: number
}

const BinaryPlaceholder = React.memo(function BinaryPlaceholder({
  fileName,
  size,
}: BinaryPlaceholderProps): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground p-6">
      <FileQuestion className="w-8 h-8 opacity-60" />
      <p className="text-sm font-mono">{fileName}</p>
      <p className="text-xs">
        Cannot preview binary or oversized file ({formatBytes(size)})
      </p>
    </div>
  )
})
