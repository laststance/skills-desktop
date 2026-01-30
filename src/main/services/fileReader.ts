import { readdir, readFile, stat } from 'fs/promises'
import { join, extname } from 'path'

import type { SkillFile, SkillFileContent } from '../../shared/types'

/** Supported file extensions for preview */
const PREVIEW_EXTENSIONS = [
  '.md',
  '.mjs',
  '.js',
  '.ts',
  '.json',
  '.yaml',
  '.yml',
  '.txt',
]

/**
 * List files in a skill directory
 * @param skillPath - Full path to skill directory
 * @returns Array of file info sorted by relevance (SKILL.md first)
 * @example
 * listSkillFiles('/Users/x/.agents/skills/theme-generator')
 * // => [{ name: 'SKILL.md', extension: '.md', ... }, { name: 'generator.mjs', ... }]
 */
export async function listSkillFiles(skillPath: string): Promise<SkillFile[]> {
  try {
    const entries = await readdir(skillPath, { withFileTypes: true })
    const files: SkillFile[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue

      const ext = extname(entry.name).toLowerCase()
      if (!PREVIEW_EXTENSIONS.includes(ext)) continue

      const fullPath = join(skillPath, entry.name)
      const stats = await stat(fullPath)

      files.push({
        name: entry.name,
        path: fullPath,
        extension: ext,
        size: stats.size,
      })
    }

    // Sort: SKILL.md first, then by name
    return files.sort((a, b) => {
      if (a.name === 'SKILL.md') return -1
      if (b.name === 'SKILL.md') return 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

/**
 * Read file content with metadata
 * @param filePath - Full path to file
 * @returns File content with line count
 * @example
 * readSkillFile('/Users/x/.agents/skills/theme-generator/SKILL.md')
 * // => { name: 'SKILL.md', content: '---\nname: ...', lineCount: 42 }
 */
export async function readSkillFile(
  filePath: string,
): Promise<SkillFileContent | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const name = filePath.split('/').pop() || ''
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
