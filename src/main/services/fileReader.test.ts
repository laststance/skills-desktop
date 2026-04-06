import * as fs from 'fs/promises'

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('fs/promises')

const mockFs = vi.mocked(fs)

function makeDirent(
  name: string,
  options: { isFile?: boolean; isDirectory?: boolean } = {},
): {
  name: string
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    name,
    isFile: () => options.isFile ?? true,
    isDirectory: () => options.isDirectory ?? false,
    isSymbolicLink: () => false,
  }
}

import { listSkillFiles, readSkillFile } from './fileReader'

describe('listSkillFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns SKILL.md first, then other files sorted by name', async () => {
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirent('zebra.ts'),
      makeDirent('alpha.md'),
      makeDirent('SKILL.md'),
    ])
    mockFs.stat.mockResolvedValue({ size: 100 } as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const result = await listSkillFiles('/skills/my-skill')
    expect(result[0].name).toBe('SKILL.md')
    expect(result[1].name).toBe('alpha.md')
    expect(result[2].name).toBe('zebra.ts')
  })

  it('filters out unsupported file extensions', async () => {
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirent('SKILL.md'),
      makeDirent('image.png'),
      makeDirent('binary.exe'),
      makeDirent('script.mjs'),
    ])
    mockFs.stat.mockResolvedValue({ size: 50 } as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const result = await listSkillFiles('/skills/my-skill')
    const names = result.map((f) => f.name)
    expect(names).toContain('SKILL.md')
    expect(names).toContain('script.mjs')
    expect(names).not.toContain('image.png')
    expect(names).not.toContain('binary.exe')
  })

  it('skips directory entries', async () => {
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirent('SKILL.md'),
      makeDirent('subdir', { isFile: false, isDirectory: true }),
    ])
    mockFs.stat.mockResolvedValue({ size: 200 } as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const result = await listSkillFiles('/skills/my-skill')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('SKILL.md')
  })

  it('returns file size from stat', async () => {
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirent('SKILL.md'),
    ])
    mockFs.stat.mockResolvedValue({ size: 1234 } as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const result = await listSkillFiles('/skills/my-skill')
    expect(result[0].size).toBe(1234)
  })

  it('returns correct extension for each file', async () => {
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirent('config.yaml'),
      makeDirent('helper.js'),
    ])
    mockFs.stat.mockResolvedValue({ size: 10 } as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const result = await listSkillFiles('/skills/my-skill')
    const extMap = Object.fromEntries(result.map((f) => [f.name, f.extension]))
    expect(extMap['config.yaml']).toBe('.yaml')
    expect(extMap['helper.js']).toBe('.js')
  })

  it('returns empty array when directory does not exist', async () => {
    mockFs.readdir.mockRejectedValue(new Error('ENOENT'))
    const result = await listSkillFiles('/non/existent/path')
    expect(result).toEqual([])
  })

  it('supports all documented extensions', async () => {
    const supportedFiles = [
      'a.md',
      'b.mjs',
      'c.js',
      'd.ts',
      'e.json',
      'f.yaml',
      'g.yml',
      'h.txt',
    ]
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(
      supportedFiles.map((name) => makeDirent(name)),
    )
    mockFs.stat.mockResolvedValue({ size: 1 } as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const result = await listSkillFiles('/skills/my-skill')
    expect(result).toHaveLength(supportedFiles.length)
  })
})

describe('readSkillFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns name, content, extension, and line count', async () => {
    mockFs.readFile.mockResolvedValue('line one\nline two\nline three')

    const result = await readSkillFile('/skills/my-skill/SKILL.md')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('SKILL.md')
    expect(result!.content).toBe('line one\nline two\nline three')
    expect(result!.extension).toBe('.md')
    expect(result!.lineCount).toBe(3)
  })

  it('returns null when file cannot be read', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    const result = await readSkillFile('/skills/my-skill/missing.md')
    expect(result).toBeNull()
  })

  it('counts a single-line file as 1 line', async () => {
    mockFs.readFile.mockResolvedValue('just one line')

    const result = await readSkillFile('/skills/my-skill/SKILL.md')
    expect(result!.content).toBe('just one line')
    expect(result!.lineCount).toBe(1)
  })

  it('returns correct extension for TypeScript files', async () => {
    mockFs.readFile.mockResolvedValue('export const x = 1')

    const result = await readSkillFile('/skills/my-skill/helper.ts')
    expect(result!.extension).toBe('.ts')
  })

  it('returns correct extension for JSON files', async () => {
    mockFs.readFile.mockResolvedValue('{"key": "value"}')

    const result = await readSkillFile('/skills/my-skill/config.json')
    expect(result!.extension).toBe('.json')
  })

  it('returns lowercase extension', async () => {
    mockFs.readFile.mockResolvedValue('# uppercase')

    const result = await readSkillFile('/skills/my-skill/README.MD')
    expect(result!.extension).toBe('.md')
  })
})
