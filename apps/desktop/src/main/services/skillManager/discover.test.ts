import { mkdtempSync, realpathSync } from 'node:fs'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { sanitizeName } from './copyLayout'
import { discoverSkills, filterSkills, sanitizeMetadata } from './discover'

/**
 * Unit tests for discovery and name canonicalization against real temp-dir
 * fixture trees — the filesystem IS the input format here, so mocking it
 * would test nothing.
 */

const scratch = realpathSync(
  mkdtempSync(join(tmpdir(), 'skill-discover-test-')),
)

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

beforeEach(async () => {
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
})

async function writeSkill(dir: string, frontmatter: string): Promise<void> {
  await mkdir(join(scratch, dir), { recursive: true })
  await writeFile(join(scratch, dir, 'SKILL.md'), frontmatter, 'utf-8')
}

const validFrontmatter = (
  name: string,
  description = 'A description',
): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n# Body\n`

describe('sanitizeName', () => {
  test('lowercases and collapses unsafe runs into single dashes like the CLI', () => {
    expect(sanitizeName('CE:Review')).toBe('ce-review')
    expect(sanitizeName('My  Weird   Skill')).toBe('my-weird-skill')
    expect(sanitizeName('a/b\\\\c')).toBe('a-b-c')
  })

  test('keeps dots and underscores but trims them off the edges', () => {
    expect(sanitizeName('keep.dots_and-underscores')).toBe(
      'keep.dots_and-underscores',
    )
    expect(sanitizeName('..--padded--..')).toBe('padded')
  })

  test('falls back to unnamed-skill when nothing safe survives', () => {
    expect(sanitizeName('***')).toBe('unnamed-skill')
    expect(sanitizeName('')).toBe('unnamed-skill')
  })

  test('caps the result at 255 characters', () => {
    expect(sanitizeName('a'.repeat(300))).toHaveLength(255)
  })
})

describe('sanitizeMetadata', () => {
  test('strips terminal escapes and folds newlines into spaces', () => {
    expect(sanitizeMetadata('[31mred[0m text\nnext line')).toBe(
      'red text next line',
    )
  })
})

describe('discoverSkills', () => {
  test('short-circuits on a root SKILL.md as a single-skill source', async () => {
    // Arrange
    await writeSkill('.', validFrontmatter('root-skill'))
    await writeSkill('nested/other', validFrontmatter('nested-skill'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert — the nested tree is never scanned once the root qualifies.
    expect(skills.map((skill) => skill.name)).toEqual(['root-skill'])
    expect(skills[0].skillFilePath).toBe('SKILL.md')
  })

  test('discovers skills under the skills/ container with repo-relative paths', async () => {
    // Arrange
    await writeSkill('skills/one', validFrontmatter('one'))
    await writeSkill('skills/two', validFrontmatter('two'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills.map((skill) => skill.name).sort()).toEqual(['one', 'two'])
    expect(skills[0].skillFilePath).toMatch(/^skills\/(?:one|two)\/SKILL\.md$/)
  })

  test('skips skills whose frontmatter misses name or description', async () => {
    // Arrange
    await writeSkill('skills/noname', '---\ndescription: no name here\n---\n')
    await writeSkill('skills/nodesc', '---\nname: nodesc\n---\n')
    await writeSkill('skills/good', validFrontmatter('good'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills.map((skill) => skill.name)).toEqual(['good'])
  })

  test('skips metadata.internal skills like the CLI', async () => {
    // Arrange
    await writeSkill(
      'skills/internal',
      '---\nname: internal\ndescription: hidden\nmetadata:\n  internal: true\n---\n',
    )
    await writeSkill('skills/public', validFrontmatter('public'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills.map((skill) => skill.name)).toEqual(['public'])
  })

  test('treats unparseable YAML frontmatter as absent, not fatal', async () => {
    // Arrange — a tab-indented mapping is invalid YAML.
    await writeSkill('skills/broken', '---\nname:\n\tbroken: [unclosed\n---\n')
    await writeSkill('skills/good', validFrontmatter('good'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills.map((skill) => skill.name)).toEqual(['good'])
  })

  test('dedupes skills that share a frontmatter name, first match winning', async () => {
    // Arrange — same name in two containers; scan order decides the winner.
    await writeSkill('skills/dup', validFrontmatter('dup', 'from skills dir'))
    await writeSkill(
      '.claude/skills/dup',
      validFrontmatter('dup', 'from agent dir'),
    )

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills).toHaveLength(1)
    expect(skills[0].description).toBe('from skills dir')
  })

  test('falls back to a deep scan when the priority layout holds nothing', async () => {
    // Arrange — a skill buried outside every priority container.
    await writeSkill('examples/deep/buried', validFrontmatter('buried'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills.map((skill) => skill.name)).toEqual(['buried'])
    expect(skills[0].skillFilePath).toBe('examples/deep/buried/SKILL.md')
  })

  test('never descends into noise directories during the fallback scan', async () => {
    // Arrange
    await writeSkill('node_modules/dep/skill', validFrontmatter('dep-noise'))

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills).toEqual([])
  })

  test('scopes discovery to a subpath when the source carries one', async () => {
    // Arrange
    await writeSkill('plugins/scoped', validFrontmatter('scoped'))
    await writeSkill('skills/outside', validFrontmatter('outside'))

    // Act
    const skills = await discoverSkills(scratch, 'plugins')

    // Assert
    expect(skills.map((skill) => skill.name)).toEqual(['scoped'])
    // skillFilePath stays repo-relative — update checks diff against it.
    expect(skills[0].skillFilePath).toBe('plugins/scoped/SKILL.md')
  })

  test('rejects a subpath that escapes the tree', async () => {
    // Act + Assert
    await expect(discoverSkills(scratch, '../outside')).rejects.toThrow(
      'resolves outside the repository directory',
    )
  })

  test('strips terminal escapes out of discovered names and descriptions', async () => {
    // Arrange — a malicious or sloppy frontmatter carrying ANSI bytes.
    await writeSkill(
      'skills/evil',
      `---\nname: "evil\x1b[2m-skill"\ndescription: "has\x1b[31m color"\n---\n`,
    )

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills[0].name).toBe('evil-skill')
    expect(skills[0].description).toBe('has color')
  })
})

describe('filterSkills', () => {
  test('matches case-insensitively on the frontmatter name', () => {
    // Arrange
    const skills = [
      { name: 'Alpha', description: '', path: '/a', skillFilePath: 'SKILL.md' },
      { name: 'beta', description: '', path: '/b', skillFilePath: 'SKILL.md' },
    ]

    // Act + Assert
    expect(filterSkills(skills, ['ALPHA']).map((skill) => skill.name)).toEqual([
      'Alpha',
    ])
    expect(filterSkills(skills, ['beta']).map((skill) => skill.name)).toEqual([
      'beta',
    ])
    expect(filterSkills(skills, ['gamma'])).toEqual([])
  })
})

describe('discoverSkills invalid and hostile inputs', () => {
  test('ignores a SKILL.md that cannot be read instead of failing discovery', async () => {
    // Arrange — the frontmatter file exists but is unreadable.
    await writeSkill('locked-skill', validFrontmatter('locked-skill'))
    const skillMd = join(scratch, 'locked-skill', 'SKILL.md')
    await chmod(skillMd, 0o000)

    try {
      // Act
      const skills = await discoverSkills(scratch)

      // Assert — an unreadable skill is absent, never fatal.
      expect(skills).toEqual([])
    } finally {
      await chmod(skillMd, 0o644)
    }
  })

  test('rejects frontmatter whose name is not a string', async () => {
    // Arrange — YAML happily parses `name: 123` into a number.
    await writeSkill(
      'numeric-name',
      '---\nname: 123\ndescription: Valid\n---\n',
    )

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills).toEqual([])
  })

  test('descends through nested non-skill directories inside the skills container', async () => {
    // Arrange — the skill hides two directory levels below `skills/`, which
    // the priority walk only reaches by recursing past skill-less parents.
    await writeSkill(
      join('skills', 'nested', 'deeper', 'deep-skill'),
      validFrontmatter('deep-skill'),
    )

    // Act
    const skills = await discoverSkills(scratch)

    // Assert
    expect(skills.map((skill) => skill.name)).toEqual(['deep-skill'])
  })

  test('skips an unreadable directory during the fallback scan instead of throwing', async () => {
    // Arrange — nothing qualifies as a skill, and one directory cannot be
    // listed at all; the depth-5 fallback must swallow that, not crash.
    const lockedDir = join(scratch, 'locked')
    await mkdir(lockedDir, { recursive: true })
    await writeFile(join(lockedDir, 'note.txt'), 'x', 'utf-8')
    await chmod(lockedDir, 0o000)

    try {
      // Act
      const skills = await discoverSkills(scratch)

      // Assert
      expect(skills).toEqual([])
    } finally {
      await chmod(lockedDir, 0o755)
    }
  })
})
