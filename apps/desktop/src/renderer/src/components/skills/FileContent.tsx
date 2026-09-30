import { BookOpenText, Code2, FileQuestion } from 'lucide-react'
import React, { useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { match } from 'ts-pattern'

import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/renderer/src/components/shared/segmented-control'
import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { cn } from '@/renderer/src/lib/utils'
import {
  DEFAULT_CODE_THEME_ID,
  MARKDOWN_PREVIEW_MODE_KEY,
} from '@/shared/constants'
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

type MarkdownPreviewMode = 'code' | 'reading'

/** Code/Reading segments for the Markdown preview-mode toggle. */
const MARKDOWN_PREVIEW_MODE_OPTIONS: ReadonlyArray<
  SegmentedControlOption<MarkdownPreviewMode>
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

/** Preview mode used when nothing valid is stored yet, or storage is unavailable. */
const DEFAULT_MARKDOWN_PREVIEW_MODE: MarkdownPreviewMode = 'code'

/**
 * The mode the user chose most recently in THIS renderer session — including
 * when the localStorage write failed. Read ahead of storage on mount so a
 * detour through an image/binary preview (which unmounts {@link TextPreview})
 * cannot silently revert the choice under a broken storage write. Kept in sync
 * by {@link markdownPreviewModeListeners} (same-window surfaces) and the
 * `storage` event listener (other windows) — while any preview surface is
 * mounted, a newer cross-window value cannot be masked by a stale session
 * entry. (A write landing while NO surface is mounted would be missed, but
 * the only writer is `handleModeChange` inside a mounted TextPreview.)
 */
let sessionMarkdownPreviewMode: MarkdownPreviewMode | null = null

/**
 * Reset the session-level mode cache for tests — deliberately WITHOUT
 * touching localStorage: a cleared cache plus a persisted value is exactly
 * what a real app restart looks like, so restart-simulation tests pair this
 * with {@link readMarkdownPreviewMode}'s storage arm. Browser test files
 * share the module graph across tests, so a mode written by one test would
 * leak into later mounts — pair this with
 * `localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)` in the suites that
 * render {@link FileContent}.
 */
export function resetMarkdownPreviewModeForTests(): void {
  sessionMarkdownPreviewMode = null
}

/**
 * Same-window surfaces holding the preview mode. `storage` events never reach
 * the document that wrote, so a second FileContent mounted in this window
 * would diverge without this emitter — an explicit listener set covers it.
 */
const markdownPreviewModeListeners = new Set<
  (mode: MarkdownPreviewMode) => void
>()

/**
 * Coerce raw storage/event values into a known mode.
 * @param stored - `localStorage` value or `StorageEvent.newValue` (null on removal).
 * @returns The stored mode, or {@link DEFAULT_MARKDOWN_PREVIEW_MODE} when null,
 * unknown, or otherwise unusable.
 * @example modeFromStoredValue('reading') // => 'reading'
 */
function modeFromStoredValue(stored: string | null): MarkdownPreviewMode {
  // Options are the single source of truth: a future third mode becomes a
  // valid stored value automatically, and find() narrows without a cast.
  return (
    MARKDOWN_PREVIEW_MODE_OPTIONS.find((option) => option.value === stored)
      ?.value ?? DEFAULT_MARKDOWN_PREVIEW_MODE
  )
}

/**
 * Read the last-selected Markdown preview mode for this session.
 * Session cache first (see {@link sessionMarkdownPreviewMode}), then
 * localStorage, then the default — mounted {@link TextPreview} surfaces also
 * subscribe to `storage` events and same-window emissions to stay in sync.
 * @returns The most recently chosen mode, or {@link DEFAULT_MARKDOWN_PREVIEW_MODE}.
 * @example readMarkdownPreviewMode() // => 'reading'
 */
function readMarkdownPreviewMode(): MarkdownPreviewMode {
  try {
    return (
      sessionMarkdownPreviewMode ??
      modeFromStoredValue(
        window.localStorage.getItem(MARKDOWN_PREVIEW_MODE_KEY),
      )
    )
  } catch {
    // localStorage can throw in restricted-storage environments.
    return sessionMarkdownPreviewMode ?? DEFAULT_MARKDOWN_PREVIEW_MODE
  }
}

/**
 * Persist the selected Markdown preview mode so it reopens the same way next time.
 * @param mode - The mode the user just selected.
 * @example writeStoredMarkdownPreviewMode('reading')
 */
function writeStoredMarkdownPreviewMode(mode: MarkdownPreviewMode): void {
  try {
    window.localStorage.setItem(MARKDOWN_PREVIEW_MODE_KEY, mode)
  } catch (error) {
    // A failing write must not break the toggle, but the consequence is real
    // (choice resets on next launch), so report it — `id:` dedupes repeats,
    // and this stays transient because the stakes are a cosmetic preference
    // (unlike the redux-state reporter's non-expiring toast).
    console.error(
      '[FileContent] persisting markdown preview mode failed',
      error,
    )
    toast.error('Preview mode could not be saved', {
      id: 'markdown-preview-mode-save-error',
      description:
        'Your choice still applies now but resets when the app closes.',
    })
  }
}

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
export const FileContent = function FileContent({
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
}

interface TextPreviewProps {
  file: SkillFileContent
  markdownFontSizePx: number
  codeFontSizePx: number
  codeThemeId: CodeThemeId
}

/**
 * Text preview shell for source-like files.
 * @param file - Loaded text file metadata and content.
 * @param markdownFontSizePx - Reading Mode body font size (CSS px).
 * @param codeFontSizePx - Code Mode font size (CSS px).
 * @param codeThemeId - Curated Shiki theme for the code preview.
 * @returns Mode toolbar plus either highlighted source or rendered Markdown.
 * @example
 * <TextPreview file={{ name: 'SKILL.md', extension: '.md', content: '# Hi', lineCount: 1 }} ... />
 */
const TextPreview = function TextPreview({
  file,
  markdownFontSizePx,
  codeFontSizePx,
  codeThemeId,
}: TextPreviewProps): React.ReactElement {
  const isMarkdown = isMarkdownPreview(file)
  const [mode, setMode] = useState<MarkdownPreviewMode>(readMarkdownPreviewMode)

  useCycleEffect(() => {
    // Two sync channels for the same preference:
    // (a) same-window surfaces — `storage` events never reach the document
    //     that wrote, so an explicit listener set covers a second FileContent
    //     mounted alongside this one;
    // (b) other windows sharing the origin — the `storage` event carries the
    //     write (or removal: newValue === null falls back to the default).
    // Both update the session cache too, so a remount can't prefer a stale
    // session value over a newer cross-window write.
    const adoptMode = (nextMode: MarkdownPreviewMode | null): void => {
      sessionMarkdownPreviewMode = nextMode
      setMode(nextMode ?? DEFAULT_MARKDOWN_PREVIEW_MODE)
    }
    const onStorage = (event: StorageEvent): void => {
      // `localStorage.clear()` fires a storage event with key === null —
      // let it through so the adopted mode resets to the default.
      if (event.key !== null && event.key !== MARKDOWN_PREVIEW_MODE_KEY) {
        return
      }
      adoptMode(
        event.newValue === null ? null : modeFromStoredValue(event.newValue),
      )
    }
    markdownPreviewModeListeners.add(adoptMode)
    window.addEventListener('storage', onStorage)
    return (): void => {
      markdownPreviewModeListeners.delete(adoptMode)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const handleModeChange = (nextMode: MarkdownPreviewMode): void => {
    writeStoredMarkdownPreviewMode(nextMode)
    // Wake every surface in this window INCLUDING this one — this surface's
    // own adoptMode is a registered listener, so its state and session
    // update ride the same path instead of being applied twice. The
    // `storage` event carries the write to other windows.
    for (const listener of markdownPreviewModeListeners) {
      listener(nextMode)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {isMarkdown && (
        <div className="shrink-0 flex items-center justify-end border-b border-border/60 bg-background/60 px-2 py-1.5">
          <SegmentedControl
            aria-label="Markdown preview mode"
            size="sm"
            value={mode}
            onValueChange={handleModeChange}
            options={MARKDOWN_PREVIEW_MODE_OPTIONS}
          />
        </div>
      )}

      {isMarkdown && mode === 'reading' ? (
        <MarkdownReadingPreview
          // Content-identity key: remount exactly when the loaded document
          // changes — so switching Markdown files always starts at the top,
          // even though the preview mode persists across the switch. This is
          // deliberately keyed on the loaded content, not the requested file
          // path: useCodePreview commits the new activeFile synchronously
          // while its content lags one IPC read, and a path-segmented key
          // would remount on the OLD document — visibly scrolling it to top
          // and re-parsing it once before the new file lands. Content as the
          // key leaves the old document painted (and its scroll position
          // stable) during that window, then remounts atomically when the new
          // bytes arrive. Same-file rerenders (font-size tweaks, a reload
          // with identical content) keep one key, so mid-read scroll is never
          // wiped; two byte-identical files sharing a key is semantically
          // indistinguishable from the same document.
          key={file.content}
          content={file.content}
          fontSizePx={markdownFontSizePx}
        />
      ) : (
        <SyntaxHighlightedCode
          // Same content-identity contract as the reading pane: a file switch
          // remounts once the new content lands — scroll (x and y) resets to
          // top instead of clamping the old offset into the new document.
          key={file.content}
          content={file.content}
          language={languageForPreview(file)}
          fontSizePx={codeFontSizePx}
          codeThemeId={codeThemeId}
        />
      )}
    </div>
  )
}

interface SyntaxHighlightedCodeProps {
  content: string
  language: string
  fontSizePx: number
  codeThemeId: CodeThemeId
}

/**
 * Build the deterministic plain-text table shown while Shiki loads or cannot parse a file.
 * @param lines - Source lines in their original order.
 * @param fontSizePx - Code font size applied to the fallback table.
 * @returns A numbered table that preserves blank lines and source ordering.
 * @example
 * renderPlainTextCode(['const value = 1', ''], 13)
 */
export const renderPlainTextCode = function renderPlainTextCode(
  lines: ReadonlyArray<string>,
  fontSizePx: number,
): React.ReactElement {
  return (
    <table
      style={{ fontSize: `${fontSizePx}px` }}
      className="w-full min-w-max font-mono leading-[1.5]"
    >
      <tbody>
        {/* Keep source line order and stable row numbers while Shiki loads. */}
        {lines.map((line, index) => (
          <tr key={index} className="hover:bg-foreground/5">
            <td className="opaque-surface sticky left-0 z-10 w-12 bg-muted px-2 py-0 text-right text-muted-foreground select-none border-r border-border/50 align-top">
              {index + 1}
            </td>
            <td className="px-3 py-0 whitespace-pre text-foreground">
              {line || ' '}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
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
const SyntaxHighlightedCode = function SyntaxHighlightedCode({
  content,
  language,
  fontSizePx,
  codeThemeId,
}: SyntaxHighlightedCodeProps): React.ReactElement {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const plainTextLines = content.split('\n')
  // Identifies which (content + language) the live `highlightedHtml` belongs to.
  // A theme-only re-highlight leaves this unchanged, so the existing colored
  // output stays mounted and is swapped only when the new theme resolves —
  // blanking it first would flash the plain-text fallback (FOUC, #221). A
  // content/language change DOES update this, so the pane blanks to plain text
  // and never bleeds the previous file's colors into the new file's preview.
  const highlightedSourceRef = useRef<{
    content: string
    language: string
  } | null>(null)

  useCycleEffect(() => {
    let cancelled = false
    // Blank only on a genuine source change (rationale on highlightedSourceRef above).
    const sourceChanged =
      highlightedSourceRef.current === null ||
      highlightedSourceRef.current.content !== content ||
      highlightedSourceRef.current.language !== language
    if (sourceChanged) {
      setHighlightedHtml(null)
    }
    highlightedSourceRef.current = { content, language }
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
              line(node, lineNumber): void {
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
    return (): void => {
      cancelled = true
    }
    // codeThemeId is a dep so switching themes re-highlights with the new pair.
  }, [content, language, codeThemeId])

  return (
    <div
      className="opaque-surface flex-1 min-h-0 overflow-auto bg-muted"
      data-file-preview-scroll
    >
      {highlightedHtml ? (
        <div
          // Font size stays on this node because preview tests and slider behavior share this DOM contract.
          style={{ fontSize: `${fontSizePx}px` }}
          className="skill-code-preview min-w-max font-mono"
          // Shiki escapes the source text before returning HTML; this injects
          // only the highlighter's `<pre><code><span>` structure and styles.
          // react-doctor-disable-next-line react-doctor/no-danger -- highlightedHtml is Shiki output; Shiki HTML-escapes the source text and emits only its own <pre><code><span> markup, so there is no attacker-controlled HTML path here.
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        renderPlainTextCode(plainTextLines, fontSizePx)
      )}
      <div className="h-8" data-file-preview-bottom-spacer aria-hidden />
    </div>
  )
}

interface MarkdownReadingPreviewProps {
  content: string
  fontSizePx: number
}

// Module-level so the array identity survives rerenders — react-markdown
// rebuilds its processor when the plugins array changes identity. Frozen so a
// stray .push() can't silently invalidate every mounted processor; the cast
// bridges readonly to react-markdown's mutable Pluggable[] signature.
const MARKDOWN_REMARK_PLUGINS = Object.freeze([remarkGfm]) as unknown as [
  typeof remarkGfm,
]

/**
 * Render Markdown documents in a readable inspector view.
 * Memoized because react-markdown runs the whole unified pipeline inside render:
 * an unchanged (content, fontSizePx) pair must not re-parse the document when an
 * unrelated parent rerender flows through {@link TextPreview}. The explicit
 * memo is belt-and-suspenders — the repo otherwise relies on React Compiler for
 * memoization (the compiler pass would also cache this render), but a silent
 * compiler bailout would re-run the pipeline, so the guarantee stays explicit
 * at the source level for this one expensive subtree.
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
  const readableContent = stripMarkdownFrontmatter(content)

  return (
    <div
      // The inspector owns the backplate; another full-size background would conceal the desktop.
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
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
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
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
            'opaque-surface block max-w-full overflow-x-hidden rounded-md border border-border bg-muted px-3 py-2 font-mono text-[0.857em] leading-[2] text-foreground',
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
          'opaque-surface rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground',
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

const EmptyState = function EmptyState(): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      Select a file to preview
    </div>
  )
}

interface BinaryPlaceholderProps {
  fileName: FileName
  size: FileSizeBytes
}

const BinaryPlaceholder = function BinaryPlaceholder({
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
}
