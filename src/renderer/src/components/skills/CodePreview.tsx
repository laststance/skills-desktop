import { useCodePreview } from '../../hooks/useCodePreview'
import { cn } from '../../lib/utils'

interface CodePreviewProps {
  skillPath: string
}

/** Language detection for syntax highlighting class */
const LANG_MAP: Record<string, string> = {
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.txt': 'text',
}

/**
 * Code preview with file tabs and line numbers
 * Displays skill files with syntax highlighting
 */
export function CodePreview({
  skillPath,
}: CodePreviewProps): React.ReactElement {
  const { files, activeFile, setActiveFile, content, loading } =
    useCodePreview(skillPath)

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

  const lang = content ? LANG_MAP[content.extension] || 'text' : 'text'

  return (
    <div className="flex flex-col h-full">
      {/* File tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => setActiveFile(file.path)}
            className={cn(
              'px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
              'border-b-2 -mb-[1px]',
              activeFile === file.path
                ? 'text-primary border-primary bg-primary/5'
                : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50',
            )}
          >
            {file.name}
          </button>
        ))}
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto bg-[#0d1117] rounded-b-md pb-4">
        {content && (
          <div className={`code-${lang}`}>
            <table className="w-full text-base font-mono leading-relaxed">
              <tbody>
                {content.content.split('\n').map((line, idx, lines) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="w-12 px-2 py-0.5 text-right text-slate-500 select-none border-r border-slate-700/50">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-0.5 whitespace-pre text-slate-300">
                      <CodeLine
                        line={line}
                        lang={lang}
                        isDescriptionBody={isYamlDescriptionBody(lines, idx)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Detects if a line is a YAML description body (indented continuation after `description:`)
 * @param lines - All lines in the file
 * @param idx - Current line index
 * @returns true if this line is an indented continuation of the description field
 */
function isYamlDescriptionBody(lines: string[], idx: number): boolean {
  const line = lines[idx]
  // Must be indented with whitespace (continuation line)
  if (!/^\s{2,}/.test(line)) return false
  // If it looks like a YAML sub-key (indented key: value), it's not description text
  if (/^\s+\w[\w-]*\s*:/.test(line)) return false

  // Walk backwards to find the parent key
  for (let i = idx - 1; i >= 0; i--) {
    const prev = lines[i]
    // Skip other indented continuation lines
    if (/^\s{2,}/.test(prev) && !/^\s+\w[\w-]*\s*:/.test(prev)) continue
    // Found a non-continuation line — check if it's `description:`
    return /^description:/.test(prev)
  }
  return false
}

interface CodeLineProps {
  line: string
  lang: string
  isDescriptionBody?: boolean
}

/** Simple syntax highlighting for code lines */
function CodeLine({
  line,
  lang,
  isDescriptionBody,
}: CodeLineProps): React.ReactElement {
  // Description body gets emerald highlight for readability
  if (isDescriptionBody) {
    return <span className="text-emerald-300">{line}</span>
  }

  // Markdown highlighting
  if (lang === 'markdown') {
    // Headers
    if (line.startsWith('#')) {
      return <span className="text-cyan-400 font-semibold">{line}</span>
    }
    // Code blocks
    if (line.startsWith('```')) {
      return <span className="text-purple-400">{line}</span>
    }
    // YAML frontmatter
    if (line === '---') {
      return <span className="text-slate-500">{line}</span>
    }
    // Bold
    if (line.includes('**')) {
      return (
        <span>
          {line.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
            part.startsWith('**') ? (
              <span key={i} className="text-amber-400 font-semibold">
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </span>
      )
    }
  }

  // JavaScript/TypeScript highlighting
  if (lang === 'javascript' || lang === 'typescript') {
    // Comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
      return <span className="text-slate-500 italic">{line}</span>
    }
    // Keywords
    const keywords =
      /\b(const|let|var|function|async|await|return|import|export|from|if|else|for|while)\b/g
    const strings = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g

    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match

    // Highlight strings first
    const stringMatches: { start: number; end: number; text: string }[] = []
    while ((match = strings.exec(line)) !== null) {
      stringMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      })
    }

    // Highlight keywords (not inside strings)
    keywords.lastIndex = 0
    while ((match = keywords.exec(line)) !== null) {
      const inString = stringMatches.some(
        (s) => match!.index >= s.start && match!.index < s.end,
      )
      if (!inString) {
        if (match.index > lastIndex) {
          parts.push(
            <span key={lastIndex}>{line.slice(lastIndex, match.index)}</span>,
          )
        }
        parts.push(
          <span key={match.index} className="text-purple-400">
            {match[0]}
          </span>,
        )
        lastIndex = match.index + match[0].length
      }
    }

    if (parts.length > 0) {
      if (lastIndex < line.length) {
        parts.push(<span key={lastIndex}>{line.slice(lastIndex)}</span>)
      }
      return <span>{parts}</span>
    }
  }

  // JSON highlighting
  if (lang === 'json') {
    // Keys
    if (line.includes('":')) {
      return (
        <span>
          {line.split(/("[^"]+":)/).map((part, i) =>
            part.endsWith('":') ? (
              <span key={i} className="text-cyan-400">
                {part}
              </span>
            ) : (
              <span key={i} className="text-amber-300">
                {part}
              </span>
            ),
          )}
        </span>
      )
    }
  }

  // YAML highlighting
  if (lang === 'yaml') {
    // Keys
    if (line.includes(':')) {
      const [key, ...rest] = line.split(':')
      return (
        <span>
          <span className="text-cyan-400">{key}</span>
          <span className="text-slate-400">:</span>
          <span className="text-amber-300">{rest.join(':')}</span>
        </span>
      )
    }
  }

  // Default: no highlighting
  return <span>{line || ' '}</span>
}
