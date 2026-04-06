import * as fs from 'fs/promises'

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('fs/promises')

const mockFs = vi.mocked(fs)

import { parseSkillMetadata } from './metadataParser'

describe('parseSkillMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns name and description from frontmatter', async () => {
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: Does great things\n---\n# Content',
    )
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('Does great things')
  })

  it('falls back to directory name when SKILL.md is missing', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
    const result = await parseSkillMetadata('/skills/theme-generator')
    expect(result.name).toBe('theme-generator')
    expect(result.description).toBe('')
  })

  it('uses directory name when frontmatter has no name field', async () => {
    mockFs.readFile.mockResolvedValue('---\ndescription: A cool skill\n---\n')
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('A cool skill')
  })

  it('returns empty description when frontmatter has no description field', async () => {
    mockFs.readFile.mockResolvedValue('---\nname: My Skill\n---\n')
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.name).toBe('My Skill')
    expect(result.description).toBe('')
  })

  it('handles SKILL.md with no frontmatter block', async () => {
    mockFs.readFile.mockResolvedValue('# Just a heading\nSome content')
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('')
  })

  it('reads SKILL.md from the skill directory', async () => {
    mockFs.readFile.mockResolvedValue('---\nname: Test\n---\n')
    await parseSkillMetadata('/skills/test-skill')
    expect(mockFs.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/test-skill[/\\]SKILL\.md$/),
      'utf-8',
    )
  })

  it('strips surrounding quotes from values', async () => {
    mockFs.readFile.mockResolvedValue(
      '---\nname: "Quoted Name"\ndescription: \'Single quoted\'\n---\n',
    )
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.name).toBe('Quoted Name')
    expect(result.description).toBe('Single quoted')
  })

  it('handles multiline description with pipe (|) syntax', async () => {
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: |\n  This is the first line\n---\n',
    )
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.description).toBe('This is the first line')
  })

  it('handles multiline description with folded (>) syntax', async () => {
    mockFs.readFile.mockResolvedValue(
      '---\nname: My Skill\ndescription: >\n  Folded content\n---\n',
    )
    const result = await parseSkillMetadata('/skills/my-skill')
    expect(result.description).toBe('Folded content')
  })

  it('falls back to directory name when skill path has trailing slash edge case', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
    const result = await parseSkillMetadata('/skills/edge-case/')
    expect(result.name).toBe('edge-case')
  })

  it('falls back to Unknown when path is empty', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
    const result = await parseSkillMetadata('')
    expect(result.name).toBe('Unknown')
  })
})
