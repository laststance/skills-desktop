import { BookOpenText, Code2, FileQuestion } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { match } from 'ts-pattern'

import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/renderer/src/components/shared/segmented-control'
import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { cn } from '@/renderer/src/lib/utils'
import { DEFAULT_CODE_THEME_ID } from '@/shared/constants'
import type { CodeThemeId } from '@/shared/constants'
import { formatBytes } from '@/shared/fileTypes'
import {
  CODE_FONT_SIZE_DEFAULT_PX,
  MARKDOWN_FONT_SIZE_DEFAULT_PX,
} from '@/shared/settings'
import type { FileName, FileSizeBytes, SkillFileContent } from '@/shared/types'

import { resolveCodeTheme } from './codeThemeHelpers'
import { isMarkdownPreview, languageForPreview } from './filePreviewLanguage'
import { codeToHtml } from './shikiPreview'

interface FileContentProps {
  content: PreviewContent
  /** Markdown reading-mode body font size (CSS px). */
  markdownFontSizePx?: number
  /** Shiki code preview font size (CSS px). */
  codeFontSizePx?: number
  /** Curated Shiki theme id for the code preview. */
  codeThemeId?: CodeThemeId
}

type TextPreviewMode = 'code' | 'reading'

/** Code/Reading segments for the Markdown preview-mode toggle. */
const TEXT_PREVIEW_MODE_OPTIONS: ReadonlyArray<
  SegmentedControlOption<TextPreviewMode>
> = [
  {
    value: 'code',
    label: 'Code',
    icon: Code2,
    ariaLabel: 'Show Markdown source',
  },
  {
    value: 'reading',
    label: 'Reading',
    icon: BookOpenText,
    ariaLabel: 'Show rendered Markdown',
  },
]

/**
 * Right-panel file preview. Switches on `content.kind`:
 * - `text`   -> highlighted code view, plus Reading Mode for Markdown files
 * - `image`  -> centered `<img>` sourced from a base64 data URL
 * - `binary` -> placeholder with filename + size
 * - `empty`  -> "no file selected" placeholder
 *
 * Shiki provides TextMate-grade highlighting while `react-markdown` keeps
 * Markdown rendering safe by default: raw HTML is not enabled here.
 */
export const FileContent = React.memo(function FileContent({
  content,
  markdownFontSizePx = MARKDOWN_FONT_SIZE_DEFAULT_PX,
  codeFontSizePx = CODE_FONT_SIZE_DEFAULT_PX,
  codeThemeId = DEFAULT_CODE_THEME_ID,
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
      <div className="flex-1 min-h-0 overflow-auto bg-muted p-6 flex items-center justify-center">
        <img
          src={data.dataUrl}
          alt={data.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    ))
    .with({ kind: 'text' }, ({ data }) => (
      <TextPreview
        file={data}
        markdownFontSizePx={markdownFontSizePx}
        codeFontSizePx={codeFontSizePx}
        codeThemeId={codeThemeId}
      />
    ))
    .exhaustive()
})

interface TextPreviewProps {
  file: SkillFileContent
  markdownFontSizePx: number
  codeFontSizePx: number
  codeThemeId: CodeThemeId
}

/**
 * Text preview shell for source-like files.
 * @param file - Loaded text file metadata and content.
 * @returns Mode toolbar plus either highlighted source or rendered Markdown.
 * @example
 * <TextPreview file={{ name: 'SKILL.md', extension: '.md', content: '# Hi', lineCount: 1 }} />
 */
const TextPreview = React.memo(function TextPreview({
  file,
  markdownFontSizePx,
  codeFontSizePx,
  codeThemeId,
}: TextPreviewProps): React.ReactElement {
  const isMarkdown = isMarkdownPreview(file)
  const fileIdentity = `${file.name}:${file.extension}`
  const [mode, setMode] = useState<TextPreviewMode>('code')

  useCycleEffect(() => {
    setMode('code')
  }, [fileIdentity])

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-muted">
      {isMarkdown && (
        <div className="shrink-0 flex items-center justify-end border-b border-border/60 bg-background/60 px-2 py-1.5">
          <SegmentedControl
            aria-label="Markdown preview mode"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={TEXT_PREVIEW_MODE_OPTIONS}
          />
        </div>
      )}

      {isMarkdown && mode === 'reading' ? (
        <MarkdownReadingPreview
          content={file.content}
          fontSizePx={markdownFontSizePx}
        />
      ) : (
        <SyntaxHighlightedCode
          content={file.content}
          language={languageForPreview(file)}
          fontSizePx={codeFontSizePx}
          codeThemeId={codeThemeId}
        />
      )}
    </div>
  )
})

interface SyntaxHighlightedCodeProps {
  content: string
  language: string
  fontSizePx: number
  codeThemeId: CodeThemeId
}

/**
 * Highlight code asynchronously with Shiki.
 * @param content - Raw file text.
 * @param language - Shiki language identifier.
 * @param fontSizePx - Code font size; line metrics scale with it via em CSS.
 * @param codeThemeId - Curated Shiki theme id resolved to a light/dark pair.
 * @returns Scrollable highlighted source with a bottom spacer after the final
 * line so the last row is reachable and not pinned to the pane edge.
 * @example
 * <SyntaxHighlightedCode content="const x = 1" language="typescript" fontSizePx={13} codeThemeId="github" />
 */
const SyntaxHighlightedCode = React.memo(function SyntaxHighlightedCode({
  content,
  language,
  fontSizePx,
  codeThemeId,
}: SyntaxHighlightedCodeProps): React.ReactElement {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const plainTextLines = useMemo(() => content.split('\n'), [content])

  useCycleEffect(() => {
    let cancelled = false
    setHighlightedHtml(null)
    // Resolve inside the effect so a theme change re-runs highlighting; the
    // light/dark keys feed the --shiki-light / --shiki-dark CSS var bridge.
    const codeTheme = resolveCodeTheme(codeThemeId)

    async function highlight(): Promise<void> {
      try {
        const html = await codeToHtml(content, {
          lang: language,
          themes: {
            dark: codeTheme.dark,
            light: codeTheme.light,
          },
          defaultColor: false,
          transformers: [
            {
              line(node, lineNumber) {
                node.children.unshift({
                  type: 'element',
                  tagName: 'span',
                  properties: {
                    ariaHidden: 'true',
                    class: 'line-number',
                  },
                  children: [{ type: 'text', value: String(lineNumber) }],
                })
              },
            },
          ],
        })
        if (!cancelled) setHighlightedHtml(html)
      } catch {
        // Unsupported grammars should never blank the preview; plain text is
        // still useful when Shiki cannot parse a newly-added file type.
        if (!cancelled) setHighlightedHtml(null)
      }
    }

    void highlight()
    return () => {
      cancelled = true
    }
    // codeThemeId is a dep so switching themes re-highlights with the new pair.
  }, [content, language, codeThemeId])

  return (
    <div
      className="flex-1 min-h-0 overflow-auto bg-muted"
      data-file-preview-scroll
    >
      {highlightedHtml ? (
        <div
          // Font size is inline so the slider scales it; `.line` line-height in
          // globals.css is unitless, so rows scale with the font.
          style={{ fontSize: `${fontSizePx}px` }}
          className="skill-code-preview min-w-max font-mono"
          // Shiki escapes the source text before returning HTML; this injects
          // only the highlighter's `<pre><code><span>` structure and styles.
          // react-doctor-disable-next-line react-doctor/no-danger -- highlightedHtml is Shiki output; Shiki HTML-escapes the source text and emits only its own <pre><code><span> markup, so there is no attacker-controlled HTML path here.
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <PlainTextCode lines={plainTextLines} fontSizePx={fontSizePx} />
      )}
      <div className="h-8" data-file-preview-bottom-spacer aria-hidden />
    </div>
  )
})

interface PlainTextCodeProps {
  lines: string[]
  fontSizePx: number
}

/**
 * Immediate plain-text fallback shown while Shiki loads or when highlighting
 * fails for an unknown grammar.
 * @param lines - Raw content split on newline boundaries.
 * @param fontSizePx - Code font size; unitless line-height keeps rows scaling.
 * @returns Line-numbered plain text table.
 * @example
 * <PlainTextCode lines={['first', 'second']} fontSizePx={13} />
 */
const PlainTextCode = React.memo(function PlainTextCode({
  lines,
  fontSizePx,
}: PlainTextCodeProps): React.ReactElement {
  return (
    <table
      style={{ fontSize: `${fontSizePx}px` }}
      className="w-full min-w-max font-mono leading-[1.5]"
    >
      <tbody>
        {lines.map((line, idx) => (
          <tr key={idx} className="hover:bg-foreground/5">
            <td className="sticky left-0 z-10 w-12 bg-muted px-2 py-0 text-right text-muted-foreground select-none border-r border-border/50 align-top">
              {idx + 1}
            </td>
            <td className="px-3 py-0 whitespace-pre text-foreground">
              {line || ' '}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
})

interface MarkdownReadingPreviewProps {
  content: string
  fontSizePx: number
}

/**
 * Render Markdown documents in a readable inspector view.
 * @param content - Markdown source.
 * @param fontSizePx - Body font size; headings/code/tables scale via em.
 * @returns Scrollable article with GitHub Flavored Markdown features enabled.
 * @example
 * <MarkdownReadingPreview content="# Title\n\n- [x] done" fontSizePx={14} />
 */
const MarkdownReadingPreview = React.memo(function MarkdownReadingPreview({
  content,
  fontSizePx,
}: MarkdownReadingPreviewProps): React.ReactElement {
  const readableContent = useMemo(
    () => stripMarkdownFrontmatter(content),
    [content],
  )
  const remarkPlugins = useMemo(() => [remarkGfm], [])

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-background"
      data-markdown-reading-scroll
    >
      {/* Inline font size is the scale anchor: child sizes are em (heading,
          code, table), so the whole document scales from this one value.
          `leading-loose` (2.0) matches the prior `leading-7` (28px ÷ 14px). */}
      <article
        style={{ fontSize: `${fontSizePx}px` }}
        className="markdown-reading-prose min-w-0 max-w-full overflow-x-hidden break-words px-7 py-6 pb-10 leading-loose text-foreground"
      >
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={markdownComponents}
        >
          {readableContent}
        </ReactMarkdown>
      </article>
    </div>
  )
})

/**
 * Remove leading YAML frontmatter from the Reading Mode body.
 * @param content - Raw Markdown source.
 * @returns Markdown without a leading `---` metadata block.
 * @example
 * stripMarkdownFrontmatter('---\nname: demo\n---\n# Demo') // => '# Demo'
 */
function stripMarkdownFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  if (!match) return content
  if (!looksLikeYamlFrontmatter(match[0])) return content
  return content.slice(match[0].length).trimStart()
}

/**
 * Distinguish YAML metadata from a Markdown document that simply starts with a
 * horizontal rule.
 * @param rawBlock - Matched `--- ... ---` block from the start of the file.
 * @returns True when at least one non-comment line looks like a YAML key.
 * @example
 * looksLikeYamlFrontmatter('---\nname: demo\n---') // => true
 */
function looksLikeYamlFrontmatter(rawBlock: string): boolean {
  const lines = rawBlock
    .replace(/^---\r?\n/, '')
    .replace(/\r?\n---\r?\n?$/, '')
    .split(/\r?\n/)

  return lines.some((line) => {
    const trimmed = line.trim()
    // Blank lines and comments are allowed inside real YAML frontmatter.
    if (trimmed === '' || trimmed.startsWith('#')) return false
    return /^[A-Za-z0-9_-]+:\s*/.test(trimmed)
  })
}

/**
 * Remove react-markdown's internal AST prop before DOM spreading.
 * @param props - Component override props from react-markdown.
 * @returns The same props without the non-DOM `node` field.
 * @example
 * omitMarkdownNode({ node: astNode, href: '/docs' }) // => { href: '/docs' }
 */
function omitMarkdownNode<Props extends { node?: unknown }>(
  props: Props,
): Omit<Props, 'node'> {
  const { node, ...domProps } = props
  // `node` is useful for custom renderers, but invalid on real DOM elements.
  void node
  return domProps
}

/**
 * Detect code blocks produced by react-markdown.
 * @param children - Rendered code text from the Markdown AST.
 * @param className - Optional `language-*` class from a fenced code info string.
 * @returns True for fenced/indented code blocks, including fences with no language.
 * @example
 * isMarkdownCodeBlock('pnpm validate\n') // => true
 */
function isMarkdownCodeBlock(
  children: React.ReactNode,
  className?: string,
): boolean {
  // Language-tagged fences are always block code.
  if (className?.includes('language-')) return true

  // Guard the react-markdown v10 newline heuristic with browser tests: block
  // code keeps a trailing newline, while inline code does not.
  return typeof children === 'string' && children.endsWith('\n')
}

const markdownComponents: Components = {
  a({ children, className, href, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <a
        {...domProps}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'text-primary underline underline-offset-4 hover:text-primary/80',
          className,
        )}
      >
        {children}
      </a>
    )
  },
  blockquote({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <blockquote
        {...domProps}
        className={cn(
          'my-4 border-l-2 border-primary/60 pl-4 text-muted-foreground',
          className,
        )}
      >
        {children}
      </blockquote>
    )
  },
  code({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    if (isMarkdownCodeBlock(children, className)) {
      return (
        <code
          {...domProps}
          className={cn(
            // em sizes (text-xs≈0.857em, leading-6≈2) so block code scales
            // with the Markdown body font instead of staying a fixed 12px.
            'block max-w-full overflow-x-hidden rounded-md border border-border bg-muted px-3 py-2 font-mono text-[0.857em] leading-[2] text-foreground',
            className,
          )}
        >
          {children}
        </code>
      )
    }

    return (
      <code
        {...domProps}
        className={cn(
          'rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground',
          className,
        )}
      >
        {children}
      </code>
    )
  },
  h1({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <h1
        {...domProps}
        className={cn(
          // text-2xl (24px) as em (24÷14) so headings scale with the body font.
          'mb-4 mt-0 border-b border-border pb-3 text-[1.714em] font-semibold leading-tight',
          className,
        )}
      >
        {children}
      </h1>
    )
  },
  h2({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <h2
        {...domProps}
        className={cn(
          // text-xl (20px) as em (20÷14) so headings scale with the body font.
          'mb-3 mt-7 border-b border-border/70 pb-2 text-[1.429em] font-semibold leading-tight',
          className,
        )}
      >
        {children}
      </h2>
    )
  },
  h3({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <h3
        {...domProps}
        className={cn(
          // text-base (16px) as em (16÷14); leading-normal restores the line
          // height that the named text-base utility used to supply.
          'mb-2 mt-6 text-[1.143em] font-semibold leading-normal',
          className,
        )}
      >
        {children}
      </h3>
    )
  },
  li({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <li {...domProps} className={cn('my-1 pl-1', className)}>
        {children}
      </li>
    )
  },
  ol({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <ol {...domProps} className={cn('my-4 list-decimal pl-6', className)}>
        {children}
      </ol>
    )
  },
  p({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <p {...domProps} className={cn('my-3', className)}>
        {children}
      </p>
    )
  },
  pre({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <pre
        {...domProps}
        className={cn('my-4 max-w-full overflow-x-hidden', className)}
      >
        {children}
      </pre>
    )
  },
  table({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <div className="my-4 max-w-full overflow-x-hidden rounded-md border border-border">
        <table
          {...domProps}
          className={cn(
            // No explicit size: the table inherits the article's em font so it
            // scales with the Markdown body (was a fixed text-sm/14px).
            'w-full table-fixed border-collapse text-left',
            className,
          )}
        >
          {children}
        </table>
      </div>
    )
  },
  td({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <td
        {...domProps}
        className={cn(
          'break-words border-t border-border px-3 py-2 align-top',
          className,
        )}
      >
        {children}
      </td>
    )
  },
  th({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <th
        {...domProps}
        className={cn(
          'break-words border-b border-border bg-muted px-3 py-2 font-semibold',
          className,
        )}
      >
        {children}
      </th>
    )
  },
  ul({ children, className, ...props }) {
    const domProps = omitMarkdownNode(props)

    return (
      <ul {...domProps} className={cn('my-4 list-disc pl-6', className)}>
        {children}
      </ul>
    )
  },
}

const EmptyState = React.memo(function EmptyState(): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      Select a file to preview
    </div>
  )
})

interface BinaryPlaceholderProps {
  fileName: FileName
  size: FileSizeBytes
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
