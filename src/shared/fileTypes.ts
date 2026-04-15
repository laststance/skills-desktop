/**
 * File classification constants + helpers shared by main and renderer.
 * Kept in /shared so renderer never duplicates the "what counts as previewable" rule.
 */

/**
 * Text file extensions that the right pane can render with a <pre> block.
 * Extensions MUST be lowercase and include the leading dot.
 * @example '.md' | '.py' | '.toml'
 */
export const PREVIEW_EXTENSIONS = [
  // Docs / config
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ini',
  '.env.example',
  // JS / TS family
  '.mjs',
  '.cjs',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  // Other languages commonly found in skill repos
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.lua',
  '.sql',
  // Web
  '.css',
  '.scss',
  '.html',
  '.svg',
] as const

/**
 * Image extensions to MIME types. Single source of truth for image handling;
 * IMAGE_EXTENSIONS is derived from this so adding a new image type here is
 * picked up by both `classifyFile` and the base64 reader.
 */
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
} as const

/**
 * Image extensions that the right pane can render as a preview.
 * Derived from IMAGE_MIME_TYPES so the two never drift.
 * NOTE: `.svg` is in PREVIEW_EXTENSIONS since it is text; classifyFile()
 * prefers the text path so users can read the markup.
 */
export const IMAGE_EXTENSIONS: readonly string[] = Object.keys(IMAGE_MIME_TYPES)

/**
 * Directory names that must be skipped entirely when recursing into a skill.
 * These are either VCS metadata, generated artefacts, or dependency installs
 * that bloat the tree and are never relevant to a skill's user-facing content.
 */
export const EXCLUDED_DIRS: readonly string[] = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.cache',
  '.next',
  'dist',
  'build',
  'coverage',
  '.DS_Store',
] as const

/** Maximum text file size (bytes) that the reader will return. Larger files are marked binary. */
export const MAX_TEXT_FILE_BYTES = 512 * 1024 // 512 KB

/** Maximum image file size (bytes) that the reader will base64-encode. Larger files fall back to a placeholder. */
export const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

/** Maximum recursion depth when walking a skill directory. Depth 0 = skill root. */
export const MAX_TREE_DEPTH = 4

/**
 * Discriminator for how the renderer should display a given file.
 * - `text`: render the raw UTF-8 body in a <pre> block
 * - `image`: fetch as base64 via files:readBinary, render in an <img>
 * - `binary`: show a "binary file — cannot preview" placeholder
 */
export type FilePreviewKind = 'text' | 'image' | 'binary'

/**
 * Lowercase extension for a file name, with the multi-dot `.env.example`
 * edge case handled so extname()'s `.example` read doesn't leak downstream.
 * @param fileName - Basename, not path.
 * @returns Lowercase extension including the leading dot, or '' when none.
 * @example
 * getNormalizedExtension('SKILL.md')     // => '.md'
 * getNormalizedExtension('logo.PNG')     // => '.png'
 * getNormalizedExtension('.env.example') // => '.env.example'
 * getNormalizedExtension('Makefile')     // => ''
 */
export function getNormalizedExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.env.example')) return '.env.example'
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot) : ''
}

/**
 * Classify a file by its name so the main process knows which reader path to use
 * and the renderer knows which view to render.
 *
 * SVG is intentionally treated as text (markup is more useful than the image).
 *
 * @param fileName - Basename, not path. Casing is ignored.
 * @returns
 * - 'text' when the extension is in PREVIEW_EXTENSIONS
 * - 'image' when the extension is in IMAGE_EXTENSIONS
 * - 'binary' otherwise
 * @example
 * classifyFile('SKILL.md')   // => 'text'
 * classifyFile('logo.PNG')   // => 'image'
 * classifyFile('icon.svg')   // => 'text'
 * classifyFile('data.bin')   // => 'binary'
 */
export function classifyFile(fileName: string): FilePreviewKind {
  const ext = getNormalizedExtension(fileName)
  if ((PREVIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'text'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  return 'binary'
}

/**
 * Decide whether to skip a directory entry during tree traversal.
 * @param name - Directory basename.
 * @returns true iff the name is in EXCLUDED_DIRS.
 * @example
 * shouldExcludeDir('node_modules') // => true
 * shouldExcludeDir('src')          // => false
 * shouldExcludeDir('.git')         // => true
 */
export function shouldExcludeDir(name: string): boolean {
  return EXCLUDED_DIRS.includes(name)
}

/**
 * Format a byte count as a human-readable string (B / KB / MB / GB).
 * @param bytes - Number of bytes.
 * @returns String with unit suffix; 1-decimal precision above B.
 * @example
 * formatBytes(512)      // => '512 B'
 * formatBytes(1024)     // => '1.0 KB'
 * formatBytes(5242880)  // => '5.0 MB'
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}
