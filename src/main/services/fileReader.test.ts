import * as fs from 'fs/promises'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  MAX_IMAGE_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
} from '../../shared/fileTypes'

vi.mock('fs/promises')

const mockFs = vi.mocked(fs)

interface DirentLike {
  name: string
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}

function makeDirent(
  name: string,
  options: {
    isFile?: boolean
    isDirectory?: boolean
    isSymbolicLink?: boolean
  } = {},
): DirentLike {
  const isDir = options.isDirectory ?? false
  const isLink = options.isSymbolicLink ?? false
  const isFile = options.isFile ?? (!isDir && !isLink)
  return {
    name,
    isFile: () => isFile,
    isDirectory: () => isDir,
    isSymbolicLink: () => isLink,
  }
}

/**
 * Wire up `readdir` so each path in `tree` returns its listed entries.
 * Missing paths reject (mirrors a real ENOENT).
 */
function mockTree(tree: Record<string, DirentLike[]>): void {
  ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockImplementation(
    async (path: string) => {
      const entries = tree[path as keyof typeof tree]
      if (!entries) throw new Error(`ENOENT: ${path}`)
      return entries
    },
  )
}

/**
 * Return a stat mock whose size is chosen per-path via `sizes`, defaulting to 100.
 */
function mockStat(sizes: Record<string, number> = {}, fallback = 100): void {
  ;(mockFs.stat as ReturnType<typeof vi.fn>).mockImplementation(
    async (path: string) => ({ size: sizes[path] ?? fallback }),
  )
}

import { listSkillFiles, readBinaryFile, readSkillFile } from './fileReader'

describe('listSkillFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns SKILL.md first, then other files sorted by relative path', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('zebra.ts'),
        makeDirent('alpha.md'),
        makeDirent('SKILL.md'),
      ],
    })
    mockStat()

    const result = await listSkillFiles('/skills/my-skill')
    expect(result.map((f) => f.name)).toEqual([
      'SKILL.md',
      'alpha.md',
      'zebra.ts',
    ])
  })

  it('filters out unsupported file extensions', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('binary.exe'),
        makeDirent('data.bin'),
        makeDirent('script.mjs'),
      ],
    })
    mockStat()

    const result = await listSkillFiles('/skills/my-skill')
    const names = result.map((f) => f.name)
    expect(names).toContain('SKILL.md')
    expect(names).toContain('script.mjs')
    expect(names).not.toContain('binary.exe')
    expect(names).not.toContain('data.bin')
  })

  it('classifies png/jpg as image previewable', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('preview.png'),
        makeDirent('photo.JPG'),
      ],
    })
    mockStat()

    const result = await listSkillFiles('/skills/my-skill')
    const byName = Object.fromEntries(result.map((f) => [f.name, f]))
    expect(byName['SKILL.md'].previewable).toBe('text')
    expect(byName['preview.png'].previewable).toBe('image')
    expect(byName['photo.JPG'].previewable).toBe('image')
  })

  it('includes python and shell files (Scope B extensions)', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('helper.py'),
        makeDirent('install.sh'),
        makeDirent('Config.toml'),
      ],
    })
    mockStat()

    const names = (await listSkillFiles('/skills/my-skill')).map((f) => f.name)
    expect(names).toContain('helper.py')
    expect(names).toContain('install.sh')
    expect(names).toContain('Config.toml')
  })

  it('recurses into subdirectories and populates relativePath', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('lib', { isDirectory: true }),
      ],
      '/skills/my-skill/lib': [makeDirent('helper.py')],
    })
    mockStat()

    const result = await listSkillFiles('/skills/my-skill')
    const byName = Object.fromEntries(result.map((f) => [f.name, f]))
    expect(byName['helper.py'].relativePath).toBe('lib/helper.py')
  })

  it('skips excluded directories entirely (node_modules, .git, __pycache__)', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('node_modules', { isDirectory: true }),
        makeDirent('.git', { isDirectory: true }),
        makeDirent('__pycache__', { isDirectory: true }),
      ],
      // These would be returned if we entered the dirs — test proves we don't.
      '/skills/my-skill/node_modules': [makeDirent('pkg.js')],
      '/skills/my-skill/.git': [makeDirent('HEAD.txt')],
      '/skills/my-skill/__pycache__': [makeDirent('cached.py')],
    })
    mockStat()

    const names = (await listSkillFiles('/skills/my-skill')).map((f) => f.name)
    expect(names).toEqual(['SKILL.md'])
  })

  it('does not follow symlinked subdirectories', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('escape', { isSymbolicLink: true, isDirectory: true }),
      ],
      '/skills/my-skill/escape': [makeDirent('secret.md')],
    })
    mockStat()

    const names = (await listSkillFiles('/skills/my-skill')).map((f) => f.name)
    expect(names).not.toContain('secret.md')
  })

  it('does not include symlinked files at the top level', async () => {
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('link.md', { isFile: false, isSymbolicLink: true }),
      ],
    })
    mockStat()

    const names = (await listSkillFiles('/skills/my-skill')).map((f) => f.name)
    expect(names).toEqual(['SKILL.md'])
  })

  it('caps recursion at MAX_TREE_DEPTH (depth 4 — file at depth 5 excluded)', async () => {
    mockTree({
      '/r': [makeDirent('a', { isDirectory: true })],
      '/r/a': [makeDirent('b', { isDirectory: true })],
      '/r/a/b': [makeDirent('c', { isDirectory: true })],
      '/r/a/b/c': [makeDirent('d', { isDirectory: true })],
      '/r/a/b/c/d': [makeDirent('e', { isDirectory: true })],
      '/r/a/b/c/d/e': [makeDirent('too-deep.md')],
    })
    mockStat()

    const names = (await listSkillFiles('/r')).map((f) => f.name)
    expect(names).not.toContain('too-deep.md')
  })

  it('includes files at the depth cap boundary', async () => {
    mockTree({
      '/r': [makeDirent('a', { isDirectory: true })],
      '/r/a': [makeDirent('b', { isDirectory: true })],
      '/r/a/b': [makeDirent('c', { isDirectory: true })],
      '/r/a/b/c': [makeDirent('d', { isDirectory: true })],
      '/r/a/b/c/d': [makeDirent('ok.md')],
    })
    mockStat()

    const names = (await listSkillFiles('/r')).map((f) => f.name)
    expect(names).toContain('ok.md')
  })

  it('marks oversized text files as previewable=binary', async () => {
    mockTree({
      '/skills/my-skill': [makeDirent('huge.md')],
    })
    mockStat({ '/skills/my-skill/huge.md': MAX_TEXT_FILE_BYTES + 1 })

    const result = await listSkillFiles('/skills/my-skill')
    expect(result[0].previewable).toBe('binary')
  })

  it('marks oversized images as previewable=binary', async () => {
    mockTree({
      '/skills/my-skill': [makeDirent('big.png')],
    })
    mockStat({ '/skills/my-skill/big.png': MAX_IMAGE_FILE_BYTES + 1 })

    const result = await listSkillFiles('/skills/my-skill')
    expect(result[0].previewable).toBe('binary')
  })

  it('returns empty array when directory does not exist', async () => {
    mockFs.readdir.mockRejectedValue(new Error('ENOENT'))
    const result = await listSkillFiles('/non/existent/path')
    expect(result).toEqual([])
  })
})

describe('readSkillFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns name, content, extension, and line count', async () => {
    mockStat({}, 100)
    mockFs.readFile.mockResolvedValue('line one\nline two\nline three')

    const result = await readSkillFile('/skills/my-skill/SKILL.md')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('SKILL.md')
    expect(result!.content).toBe('line one\nline two\nline three')
    expect(result!.extension).toBe('.md')
    expect(result!.lineCount).toBe(3)
  })

  it('returns null when file cannot be read', async () => {
    mockStat({}, 100)
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    const result = await readSkillFile('/skills/my-skill/missing.md')
    expect(result).toBeNull()
  })

  it('returns null when file exceeds MAX_TEXT_FILE_BYTES', async () => {
    mockStat({}, MAX_TEXT_FILE_BYTES + 1)

    const result = await readSkillFile('/skills/my-skill/huge.md')
    expect(result).toBeNull()
  })

  it('returns correct lowercase extension for uppercase filenames', async () => {
    mockStat({}, 10)
    mockFs.readFile.mockResolvedValue('# uppercase')

    const result = await readSkillFile('/skills/my-skill/README.MD')
    expect(result!.extension).toBe('.md')
  })
})

describe('readBinaryFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a data URL for a png file', async () => {
    mockStat({}, 4)
    mockFs.readFile.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await readBinaryFile('/skills/my-skill/preview.png')
    expect(result).not.toBeNull()
    expect(result!.mimeType).toBe('image/png')
    expect(result!.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(result!.size).toBe(4)
  })

  it('maps jpg/jpeg to image/jpeg', async () => {
    mockStat({}, 2)
    mockFs.readFile.mockResolvedValue(Buffer.from([0xff, 0xd8]))

    const a = await readBinaryFile('/skills/my-skill/photo.jpg')
    const b = await readBinaryFile('/skills/my-skill/photo.jpeg')
    expect(a!.mimeType).toBe('image/jpeg')
    expect(b!.mimeType).toBe('image/jpeg')
  })

  it('returns null for unknown extensions', async () => {
    mockStat({}, 2)
    mockFs.readFile.mockResolvedValue(Buffer.from([0, 0]))

    const result = await readBinaryFile('/skills/my-skill/data.bin')
    expect(result).toBeNull()
  })

  it('returns null when file exceeds MAX_IMAGE_FILE_BYTES', async () => {
    mockStat({}, MAX_IMAGE_FILE_BYTES + 1)

    const result = await readBinaryFile('/skills/my-skill/big.png')
    expect(result).toBeNull()
  })

  it('returns null on read error', async () => {
    mockStat({}, 2)
    mockFs.readFile.mockRejectedValue(new Error('EACCES'))

    const result = await readBinaryFile('/skills/my-skill/locked.png')
    expect(result).toBeNull()
  })

  it('emits a non-empty base64 payload for a tiny image', async () => {
    mockStat({}, 3)
    mockFs.readFile.mockResolvedValue(Buffer.from([1, 2, 3]))

    const result = await readBinaryFile('/skills/my-skill/tiny.png')
    // 3 bytes -> 4 base64 chars
    expect(result!.dataUrl.length).toBeGreaterThan(
      'data:image/png;base64,'.length,
    )
  })
})
