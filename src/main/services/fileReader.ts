import type { Dirent } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { extname, join } from 'path'

import {
  classifyFile,
  MAX_IMAGE_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_TREE_DEPTH,
  shouldExcludeDir,
} from '../../shared/fileTypes'
import type { FilePreviewKind } from '../../shared/fileTypes'
import type {
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from '../../shared/types'

/** Map image extensions to MIME types used in the data URL. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
}

/**
 * Recursively list previewable files in a skill directory.
 *
 * Guarantees (all of these protect against runaway traversal on weird skills):
 * - Depth is capped at `MAX_TREE_DEPTH` (root = depth 0).
 * - Directories matched by `shouldExcludeDir` are skipped entirely.
 * - Symlinked subdirectories are NEVER recursed into (avoids symlink loops
 *   and stops path-validation bypass via crafted links inside the skill).
 * - Text files larger than `MAX_TEXT_FILE_BYTES` are demoted to `previewable: 'binary'`
 *   so the renderer shows a "file too large" placeholder instead of attempting to read.
 *
 * @param skillPath - Absolute path to the skill directory (already path-validated upstream).
 * @returns Array sorted SKILL.md first, then alphabetical by relativePath. Empty on error.
 * @example
 * await listSkillFiles('/Users/me/.agents/skills/tdd-workflow')
 * // => [
 * //   { name: 'SKILL.md',   relativePath: 'SKILL.md',        previewable: 'text',  ... },
 * //   { name: 'helper.py',  relativePath: 'lib/helper.py',   previewable: 'text',  ... },
 * //   { name: 'logo.png',   relativePath: 'assets/logo.png', previewable: 'image', ... },
 * // ]
 */
export async function listSkillFiles(skillPath: string): Promise<SkillFile[]> {
  const collected: SkillFile[] = []
  try {
    await walk(skillPath, skillPath, 0, collected)
  } catch {
    return []
  }
  return collected.sort((a, b) => {
    if (a.relativePath === 'SKILL.md') return -1
    if (b.relativePath === 'SKILL.md') return 1
    return a.relativePath.localeCompare(b.relativePath)
  })
}

async function walk(
  rootPath: string,
  dirPath: string,
  depth: number,
  out: SkillFile[],
): Promise<void> {
  if (depth > MAX_TREE_DEPTH) return

  let entries: Dirent[]
  try {
    entries = (await readdir(dirPath, { withFileTypes: true })) as Dirent[]
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)

    // Symlink check runs FIRST. Dirent.isSymbolicLink() reflects the entry
    // type, not the link target, so a symlink to a directory would otherwise
    // bypass this guard if we checked isDirectory() first. Skipping symlinks
    // entirely prevents both symlink loops and symlink-based bypass of the
    // allowed-bases check (realpath happens only at the handler layer).
    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      if (shouldExcludeDir(entry.name)) continue
      await walk(rootPath, fullPath, depth + 1, out)
      continue
    }

    if (!entry.isFile()) continue

    const kind = classifyFile(entry.name)
    if (kind === 'binary') continue

    let size = 0
    try {
      size = (await stat(fullPath)).size
    } catch {
      continue
    }

    // Oversized text files are surfaced, but marked so the UI shows a placeholder.
    let previewable: FilePreviewKind = kind
    if (kind === 'text' && size > MAX_TEXT_FILE_BYTES) previewable = 'binary'
    if (kind === 'image' && size > MAX_IMAGE_FILE_BYTES) previewable = 'binary'

    const relativePath = toPosixRelative(rootPath, fullPath)
    const ext = extname(entry.name).toLowerCase()

    out.push({
      name: entry.name,
      path: fullPath,
      relativePath,
      extension: ext,
      size,
      previewable,
    })
  }
}

/**
 * Convert an absolute filesystem path into a POSIX-style path relative to `root`.
 * We always emit forward slashes so the renderer tree builder has a single
 * separator to split on regardless of host OS.
 * @example toPosixRelative('/a/b', '/a/b/lib/x.py') // => 'lib/x.py'
 */
function toPosixRelative(root: string, full: string): string {
  const rel = full.slice(root.length).replace(/^[/\\]+/, '')
  return rel.split(/[/\\]+/).join('/')
}

/**
 * Read a text file's content, capped at `MAX_TEXT_FILE_BYTES`.
 * Oversized files resolve to null so the renderer shows a placeholder
 * instead of ballooning the IPC message.
 * @param filePath - Already path-validated absolute path.
 * @returns File body + line count, or null on error / oversize / classification mismatch.
 * @example
 * await readSkillFile('/skills/tdd/SKILL.md')
 * // => { name: 'SKILL.md', content: '...', extension: '.md', lineCount: 42 }
 */
export async function readSkillFile(
  filePath: string,
): Promise<SkillFileContent | null> {
  try {
    const size = (await stat(filePath)).size
    if (size > MAX_TEXT_FILE_BYTES) return null

    const content = await readFile(filePath, 'utf-8')
    const name = filePath.split(/[/\\]+/).pop() || ''
    const ext = extname(name).toLowerCase()

    return {
      name,
      content,
      extension: ext,
      lineCount: content.split('\n').length,
    }
  } catch {
    return null
  }
}

/**
 * Read a binary file (image) and return it as a base64 data URL so the
 * renderer can set it directly on `<img src>`. Subject to `MAX_IMAGE_FILE_BYTES`.
 * @param filePath - Already path-validated absolute path to an image file.
 * @returns Data URL + MIME + size, or null on error / oversize / unknown extension.
 * @example
 * await readBinaryFile('/skills/tdd/assets/logo.png')
 * // => { name: 'logo.png', dataUrl: 'data:image/png;base64,...', mimeType: 'image/png', size: 2048 }
 */
export async function readBinaryFile(
  filePath: string,
): Promise<SkillBinaryContent | null> {
  try {
    const size = (await stat(filePath)).size
    if (size > MAX_IMAGE_FILE_BYTES) return null

    const name = filePath.split(/[/\\]+/).pop() || ''
    const ext = extname(name).toLowerCase()
    const mimeType = IMAGE_MIME_TYPES[ext]
    if (!mimeType) return null

    const buffer = await readFile(filePath)
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`

    return { name, dataUrl, mimeType, size }
  } catch {
    return null
  }
}
