import * as fs from 'fs/promises'

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('fs/promises')

const mockFs = vi.mocked(fs)

import { parseSkillMetadata } from './metadataParser'

describe('parseSkillMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces the name and description declared in frontmatter', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: Does great things\n---\n# Content',
    )

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('Does great things')
  })

  it('names the skill after its directory when SKILL.md is missing', async () => {
    // Arrange
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await parseSkillMetadata('/skills/theme-generator')

    // Assert
    expect(result.name).toBe('theme-generator')
    expect(result.description).toBe('')
  })

  it('names the skill after its directory when frontmatter omits the name field', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('---\ndescription: A cool skill\n---\n')

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('A cool skill')
  })

  it('leaves the description blank when frontmatter omits the description field', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('---\nname: My Skill\n---\n')

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('')
  })

  it('falls back to the directory name when SKILL.md has no frontmatter block', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('# Just a heading\nSome content')

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('')
  })

  it('reads metadata from the SKILL.md inside the skill directory', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue('---\nname: Test\n---\n')

    // Act
    await parseSkillMetadata('/skills/test-skill')

    // Assert
    expect(mockFs.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/test-skill[/\\]SKILL\.md$/),
      'utf-8',
    )
  })

  it('strips surrounding single and double quotes from frontmatter values', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: "Quoted Name"\ndescription: \'Single quoted\'\n---\n',
    )

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.name).toBe('Quoted Name')
    expect(result.description).toBe('Single quoted')
  })

  it('reads the first line of a pipe (|) block-scalar description', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: |\n  This is the first line\n---\n',
    )

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.description).toBe('This is the first line')
  })

  it('reads the content of a folded (>) block-scalar description', async () => {
    // Arrange
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: >\n  Folded content\n---\n',
    )

    // Act
    const result = await parseSkillMetadata('/skills/my-skill')

    // Assert
    expect(result.description).toBe('Folded content')
  })

  it('strips a trailing slash before deriving the directory name fallback', async () => {
    // Arrange
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await parseSkillMetadata('/skills/edge-case/')

    // Assert
    expect(result.name).toBe('edge-case')
  })

  it('names the skill Unknown when given an empty path', async () => {
    // Arrange
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await parseSkillMetadata('')

    // Assert
    expect(result.name).toBe('Unknown')
  })
})
