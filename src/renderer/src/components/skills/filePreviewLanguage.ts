import type { SkillFileContent } from '@/shared/types'

/**
 * Language identifiers understood by Shiki's bundled highlighter.
 * Keeping these values as named strings keeps the renderer-side preview
 * independent from filesystem extension quirks such as `.env.example`.
 */
export type ShikiPreviewLanguage =
  | 'bash'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'dockerfile'
  | 'dotenv'
  | 'fish'
  | 'go'
  | 'html'
  | 'ini'
  | 'java'
  | 'javascript'
  | 'json'
  | 'jsonc'
  | 'jsx'
  | 'kotlin'
  | 'lua'
  | 'make'
  | 'markdown'
  | 'mdx'
  | 'php'
  | 'python'
  | 'ruby'
  | 'rust'
  | 'scss'
  | 'sql'
  | 'swift'
  | 'text'
  | 'toml'
  | 'tsx'
  | 'typescript'
  | 'xml'
  | 'yaml'
  | 'zsh'

/**
 * Normalize user/file-system extensions into the lookup key shape.
 * @param extension - Optional file extension, with or without a leading dot.
 * @returns Lowercase extension with a leading dot, or undefined when missing.
 * @example
 * normalizeFileExtension('MD') // => '.md'
 */
function normalizeFileExtension(extension?: string | null): string | undefined {
  if (!extension) return undefined

  const lowerExtension = extension.toLowerCase()
  return lowerExtension.startsWith('.') ? lowerExtension : `.${lowerExtension}`
}

/**
 * Map normalized file extensions to the Shiki grammar that best matches the
 * skill preview content.
 * @param extension - File extension, with or without its leading dot.
 * @returns Shiki language id, or `undefined` when the file should fall back to
 * plain text.
 * @example
 * languageFromExtension('.tsx') // => 'tsx'
 * languageFromExtension('ts') // => 'typescript'
 * languageFromExtension('.env.example') // => 'dotenv'
 */
export function languageFromExtension(
  extension?: string | null,
): ShikiPreviewLanguage | undefined {
  const normalized = normalizeFileExtension(extension)
  if (!normalized) return undefined

  const languageByExtension: Record<string, ShikiPreviewLanguage> = {
    '.bash': 'bash',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.css': 'css',
    '.cjs': 'javascript',
    '.env.example': 'dotenv',
    '.fish': 'fish',
    '.go': 'go',
    '.h': 'c',
    '.hpp': 'cpp',
    '.html': 'html',
    '.ini': 'ini',
    '.java': 'java',
    '.js': 'javascript',
    '.json': 'json',
    '.jsonc': 'jsonc',
    '.jsx': 'jsx',
    '.kt': 'kotlin',
    '.lua': 'lua',
    '.markdown': 'markdown',
    '.md': 'markdown',
    '.mdown': 'markdown',
    '.mdx': 'mdx',
    '.mjs': 'javascript',
    '.php': 'php',
    '.py': 'python',
    '.rb': 'ruby',
    '.rs': 'rust',
    '.scss': 'scss',
    '.sh': 'bash',
    '.sql': 'sql',
    '.svg': 'xml',
    '.swift': 'swift',
    '.toml': 'toml',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.txt': 'text',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.zsh': 'zsh',
  }

  return languageByExtension[normalized]
}

/**
 * Infer the Shiki language for a loaded text file.
 * @param file - Text content returned by the main-process reader.
 * @returns Shiki language id. Uses `text` as a safe fallback because Shiki can
 * render it without a grammar.
 * @example
 * languageForPreview({ name: 'SKILL.md', extension: '.md', content: '', lineCount: 1 })
 * // => 'markdown'
 */
export function languageForPreview(
  file: Pick<SkillFileContent, 'extension' | 'name'>,
): ShikiPreviewLanguage {
  // Extension wins because the main process already normalizes special cases.
  const byExtension = languageFromExtension(file.extension)
  if (byExtension) return byExtension

  // Extensionless files can still be common developer text formats.
  const lowerName = file.name.toLowerCase()
  if (lowerName === 'makefile') return 'make'
  if (lowerName === 'dockerfile') return 'dockerfile'

  return 'text'
}

/**
 * Identify Markdown-like files that can offer a rendered reading view.
 * @param file - Text content metadata.
 * @returns True for Markdown and MDX documents.
 * @example
 * isMarkdownPreview({ name: 'SKILL.md', extension: '.md' }) // => true
 */
export function isMarkdownPreview(
  file: Pick<SkillFileContent, 'name'> & { extension?: string | null },
): boolean {
  const extension = normalizeFileExtension(file.extension)
  if (
    extension === '.md' ||
    extension === '.markdown' ||
    extension === '.mdown' ||
    extension === '.mdx'
  ) {
    return true
  }

  const lowerName = file.name.toLowerCase()
  return lowerName === 'readme'
}
