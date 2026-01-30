import { readFile } from 'fs/promises'
import { join } from 'path'

import type { SkillMetadata } from '../../shared/types'

/**
 * Parse SKILL.md frontmatter to extract metadata
 * @param skillPath - Path to the skill directory
 * @returns Parsed metadata or default values
 * @example
 * parseSkillMetadata('/Users/.agents/skills/theme-generator')
 * // => { name: 'theme-generator', description: 'Generate color themes...' }
 */
export async function parseSkillMetadata(
  skillPath: string,
): Promise<SkillMetadata> {
  const skillMdPath = join(skillPath, 'SKILL.md')
  const dirName = skillPath.split('/').pop() || 'Unknown'

  try {
    const content = await readFile(skillMdPath, 'utf-8')
    const frontmatter = extractFrontmatter(content)

    return {
      name: frontmatter.name || dirName,
      description: frontmatter.description || '',
    }
  } catch {
    // SKILL.md not found or unreadable
    return {
      name: dirName,
      description: '',
    }
  }
}

/**
 * Extract YAML frontmatter from markdown content
 * Supports multiline values with | or > syntax
 * @param content - Raw markdown content
 * @returns Parsed frontmatter object
 * @example
 * extractFrontmatter('---\nname: foo\ndescription: |\n  Long text\n---')
 * // => { name: 'foo', description: 'Long text' }
 */
function extractFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  const lines = yaml.split('\n')
  const result: Record<string, string> = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    let value = line
      .slice(colonIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '')

    // Handle YAML multiline syntax (| or >)
    if (value === '|' || value === '>') {
      // Find the first non-empty indented line
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]
        // Check if line is indented (multiline content)
        if (nextLine.match(/^\s+\S/)) {
          value = nextLine.trim()
          break
        }
        // Stop if we hit a non-indented line (next key)
        if (nextLine.match(/^\S/)) break
      }
    }

    if (key && value && value !== '|' && value !== '>') {
      result[key] = value
    }
  }

  return result
}
