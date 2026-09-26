import * as fs from 'fs/promises'

import { describe, expect, test, vi, beforeEach } from 'vitest'

vi.mock('fs/promises')

const mockFs = vi.mocked(fs)

import { toAbsolutePath } from '@/shared/types'

import { parseSkillMetadata } from './metadataParser'

describe('parseSkillMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('surfaces the name and description declared in frontmatter', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: Does great things\n---\n# Content',
    )

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('Does great things')
  })

  test('names the skill after its directory when SKILL.md is missing', async () => {
    // Arrange
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await parseSkillMetadata(
      toAbsolutePath('/skills/theme-generator'),
    )

    // Assert
    expect(result.name).toBe('theme-generator')
    expect(result.description).toBe('')
  })

  test('names the skill after its directory when frontmatter omits the name field', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('---\ndescription: A cool skill\n---\n')

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('A cool skill')
  })

  test('leaves the description blank when frontmatter omits the description field', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('---\nname: My Skill\n---\n')

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('')
  })

  test('falls back to the directory name when SKILL.md has no frontmatter block', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('# Just a heading\nSome content')

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('')
  })

  test('reads metadata from the SKILL.md inside the skill directory', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('---\nname: Test\n---\n')

    // Act
    await parseSkillMetadata(toAbsolutePath('/skills/test-skill'))

    // Assert
    expect(mockFs.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/test-skill[/\\]SKILL\.md$/),
      'utf-8',
    )
  })

  test('strips surrounding single and double quotes from frontmatter values', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: "Quoted Name"\ndescription: \'Single quoted\'\n---\n',
    )

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('Quoted Name')
    expect(result.description).toBe('Single quoted')
  })

  test('reads the first line of a pipe (|) block-scalar description', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: |\n  This is the first line\n---\n',
    )

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.description).toBe('This is the first line')
  })

  test('reads the content of a folded (>) block-scalar description', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: >\n  Folded content\n---\n',
    )

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.description).toBe('Folded content')
  })

  test('strips a trailing slash before deriving the directory name fallback', async () => {
    // Arrange
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await parseSkillMetadata(
      toAbsolutePath('/skills/edge-case/'),
    )

    // Assert
    expect(result.name).toBe('edge-case')
  })

  test('names the skill Unknown when given an empty path', async () => {
    // Arrange
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await parseSkillMetadata(toAbsolutePath(''))

    // Assert
    expect(result.name).toBe('Unknown')
  })

  test('leaves a block-scalar description empty when the next line is another key instead of indented content', async () => {
    // Arrange
    // `description: |` is immediately followed by the `name` key (non-indented),
    // so the block scalar has no indented content line to read.
    mockFs.readFile.mockResolvedValue(
      '---\ndescription: |\nname: My Skill\n---\n',
    )

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('')
  })

  test('skips whitespace-only lines when scanning a block-scalar for content', async () => {
    // Arrange
    // After `description: |` comes a whitespace-only line (neither indented
    // content nor a new key), so the scanner skips it and continues until it
    // reaches the next non-indented key, which ends the empty block scalar.
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: |\n   \nanother_field: ignored\n---\n',
    )

    // Act
    const result = await parseSkillMetadata(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('')
  })
})
