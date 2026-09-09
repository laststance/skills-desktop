import * as fs from 'fs/promises'

import { describe, expect, test, vi, beforeEach } from 'vitest'

import { MAX_IMAGE_FILE_BYTES, MAX_TEXT_FILE_BYTES } from '@/shared/fileTypes'
import { toAbsolutePath } from '@/shared/types'

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
      const entries = tree[path]
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

  test('puts SKILL.md first and sorts the rest by relative path', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('zebra.ts'),
        makeDirent('alpha.md'),
        makeDirent('SKILL.md'),
      ],
    })
    mockStat()

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result.map((f) => f.name)).toEqual([
      'SKILL.md',
      'alpha.md',
      'zebra.ts',
    ])
  })

  test('drops files with unsupported extensions from the listing', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('binary.exe'),
        makeDirent('data.bin'),
        makeDirent('script.mjs'),
      ],
    })
    mockStat()

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    const names = result.map((f) => f.name)
    expect(names).toContain('SKILL.md')
    expect(names).toContain('script.mjs')
    expect(names).not.toContain('binary.exe')
    expect(names).not.toContain('data.bin')
  })

  test('flags png and jpg as image-previewable and markdown as text-previewable', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('preview.png'),
        makeDirent('photo.JPG'),
      ],
    })
    mockStat()

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    const byName = Object.fromEntries(result.map((f) => [f.name, f]))
    expect(byName['SKILL.md'].previewable).toBe('text')
    expect(byName['preview.png'].previewable).toBe('image')
    expect(byName['photo.JPG'].previewable).toBe('image')
  })

  test('lists python, shell, and toml files (Scope B extensions)', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('helper.py'),
        makeDirent('install.sh'),
        makeDirent('Config.toml'),
      ],
    })
    mockStat()

    // Act
    const names = (
      await listSkillFiles(toAbsolutePath('/skills/my-skill'))
    ).map((f) => f.name)

    // Assert
    expect(names).toContain('helper.py')
    expect(names).toContain('install.sh')
    expect(names).toContain('Config.toml')
  })

  test('walks into subdirectories and records each file relative path', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('lib', { isDirectory: true }),
      ],
      '/skills/my-skill/lib': [makeDirent('helper.py')],
    })
    mockStat()

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    const byName = Object.fromEntries(result.map((f) => [f.name, f]))
    expect(byName['helper.py'].relativePath).toBe('lib/helper.py')
  })

  test('never descends into node_modules, .git, or __pycache__', async () => {
    // Arrange
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

    // Act
    const names = (
      await listSkillFiles(toAbsolutePath('/skills/my-skill'))
    ).map((f) => f.name)

    // Assert
    expect(names).toEqual(['SKILL.md'])
  })

  test('refuses to traverse a symlinked subdirectory', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('escape', { isSymbolicLink: true, isDirectory: true }),
      ],
      '/skills/my-skill/escape': [makeDirent('secret.md')],
    })
    mockStat()

    // Act
    const names = (
      await listSkillFiles(toAbsolutePath('/skills/my-skill'))
    ).map((f) => f.name)

    // Assert
    expect(names).not.toContain('secret.md')
  })

  test('omits a symlinked file sitting at the top level', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('link.md', { isFile: false, isSymbolicLink: true }),
      ],
    })
    mockStat()

    // Act
    const names = (
      await listSkillFiles(toAbsolutePath('/skills/my-skill'))
    ).map((f) => f.name)

    // Assert
    expect(names).toEqual(['SKILL.md'])
  })

  test('excludes a special filesystem entry that is neither file, directory, nor symlink', async () => {
    // Arrange
    // A FIFO / socket / device node surfaces from readdir as a Dirent that is
    // not a file, not a directory, and not a symlink — it must be dropped so
    // the renderer never tries to preview an unreadable special node.
    mockTree({
      '/skills/my-skill': [
        makeDirent('SKILL.md'),
        makeDirent('pipe.fifo', {
          isFile: false,
          isDirectory: false,
          isSymbolicLink: false,
        }),
      ],
    })
    mockStat()

    // Act
    const names = (
      await listSkillFiles(toAbsolutePath('/skills/my-skill'))
    ).map((f) => f.name)

    // Assert
    expect(names).toEqual(['SKILL.md'])
  })

  test('stops recursing past the depth cap, excluding a file one level too deep', async () => {
    // Arrange
    mockTree({
      '/r': [makeDirent('a', { isDirectory: true })],
      '/r/a': [makeDirent('b', { isDirectory: true })],
      '/r/a/b': [makeDirent('c', { isDirectory: true })],
      '/r/a/b/c': [makeDirent('d', { isDirectory: true })],
      '/r/a/b/c/d': [makeDirent('e', { isDirectory: true })],
      '/r/a/b/c/d/e': [makeDirent('too-deep.md')],
    })
    mockStat()

    // Act
    const names = (await listSkillFiles(toAbsolutePath('/r'))).map(
      (f) => f.name,
    )

    // Assert
    expect(names).not.toContain('too-deep.md')
  })

  test('still lists a file sitting exactly at the depth cap boundary', async () => {
    // Arrange
    mockTree({
      '/r': [makeDirent('a', { isDirectory: true })],
      '/r/a': [makeDirent('b', { isDirectory: true })],
      '/r/a/b': [makeDirent('c', { isDirectory: true })],
      '/r/a/b/c': [makeDirent('d', { isDirectory: true })],
      '/r/a/b/c/d': [makeDirent('ok.md')],
    })
    mockStat()

    // Act
    const names = (await listSkillFiles(toAbsolutePath('/r'))).map(
      (f) => f.name,
    )

    // Assert
    expect(names).toContain('ok.md')
  })

  test('treats an over-sized text file as non-previewable binary', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [makeDirent('huge.md')],
    })
    mockStat({ '/skills/my-skill/huge.md': MAX_TEXT_FILE_BYTES + 1 })

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result[0].previewable).toBe('binary')
  })

  test('treats an over-sized image as non-previewable binary', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [makeDirent('big.png')],
    })
    mockStat({ '/skills/my-skill/big.png': MAX_IMAGE_FILE_BYTES + 1 })

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result[0].previewable).toBe('binary')
  })

  test('yields an empty listing when the directory does not exist', async () => {
    // Arrange
    mockFs.readdir.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await listSkillFiles(toAbsolutePath('/non/existent/path'))

    // Assert
    expect(result).toEqual([])
  })

  test('falls back to an empty listing when traversal throws on a malformed entry', async () => {
    // Arrange
    // readdir resolves, but the entry's own type-check throws mid-walk —
    // this escapes the readdir try/catch and must be swallowed by the
    // top-level listSkillFiles guard rather than crashing the caller.
    const explodingEntry = {
      name: 'corrupt',
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => {
        throw new Error('EIO: corrupt dirent')
      },
    }
    ;(mockFs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([
      explodingEntry,
    ])
    mockStat()

    // Act
    const result = await listSkillFiles(toAbsolutePath('/skills/my-skill'))

    // Assert
    expect(result).toEqual([])
  })

  test('drops a file from the listing when its stat call fails', async () => {
    // Arrange
    mockTree({
      '/skills/my-skill': [makeDirent('SKILL.md'), makeDirent('vanished.md')],
    })
    // SKILL.md stats fine; vanished.md disappears between readdir and stat.
    ;(mockFs.stat as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string) => {
        if (path === '/skills/my-skill/vanished.md') {
          throw new Error('ENOENT: stat after readdir')
        }
        return { size: 100 }
      },
    )

    // Act
    const names = (
      await listSkillFiles(toAbsolutePath('/skills/my-skill'))
    ).map((f) => f.name)

    // Assert
    expect(names).toEqual(['SKILL.md'])
  })
})

describe('readSkillFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('reads a file back with its name, content, extension, and line count', async () => {
    // Arrange
    mockStat({}, 100)
    mockFs.readFile.mockResolvedValue('line one\nline two\nline three')

    // Act
    const result = await readSkillFile(
      toAbsolutePath('/skills/my-skill/SKILL.md'),
    )

    // Assert
    expect(result).not.toBeNull()
    expect(result!.name).toBe('SKILL.md')
    expect(result!.content).toBe('line one\nline two\nline three')
    expect(result!.extension).toBe('.md')
    expect(result!.lineCount).toBe(3)
  })

  test('skips a file it cannot read by returning null', async () => {
    // Arrange
    mockStat({}, 100)
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))

    // Act
    const result = await readSkillFile(
      toAbsolutePath('/skills/my-skill/missing.md'),
    )

    // Assert
    expect(result).toBeNull()
  })

  test('refuses to read a file larger than the text size cap', async () => {
    // Arrange
    mockStat({}, MAX_TEXT_FILE_BYTES + 1)

    // Act
    const result = await readSkillFile(
      toAbsolutePath('/skills/my-skill/huge.md'),
    )

    // Assert
    expect(result).toBeNull()
  })

  test('lowercases the extension of an upper-cased filename', async () => {
    // Arrange
    mockStat({}, 10)
    mockFs.readFile.mockResolvedValue('# uppercase')

    // Act
    const result = await readSkillFile(
      toAbsolutePath('/skills/my-skill/README.MD'),
    )

    // Assert
    expect(result!.extension).toBe('.md')
  })
})

describe('readBinaryFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('encodes a png file as a base64 image data URL with its byte size', async () => {
    // Arrange
    mockStat({}, 4)
    mockFs.readFile.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    // Act
    const result = await readBinaryFile(
      toAbsolutePath('/skills/my-skill/preview.png'),
    )

    // Assert
    expect(result).not.toBeNull()
    expect(result!.mimeType).toBe('image/png')
    expect(result!.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(result!.size).toBe(4)
  })

  test('reports both .jpg and .jpeg as image/jpeg', async () => {
    // Arrange
    mockStat({}, 2)
    mockFs.readFile.mockResolvedValue(Buffer.from([0xff, 0xd8]))

    // Act
    const a = await readBinaryFile(toAbsolutePath('/skills/my-skill/photo.jpg'))
    const b = await readBinaryFile(
      toAbsolutePath('/skills/my-skill/photo.jpeg'),
    )

    // Assert
    expect(a!.mimeType).toBe('image/jpeg')
    expect(b!.mimeType).toBe('image/jpeg')
  })

  test('refuses to render a file with an unknown image extension', async () => {
    // Arrange
    mockStat({}, 2)
    mockFs.readFile.mockResolvedValue(Buffer.from([0, 0]))

    // Act
    const result = await readBinaryFile(
      toAbsolutePath('/skills/my-skill/data.bin'),
    )

    // Assert
    expect(result).toBeNull()
  })

  test('refuses to render an image larger than the image size cap', async () => {
    // Arrange
    mockStat({}, MAX_IMAGE_FILE_BYTES + 1)

    // Act
    const result = await readBinaryFile(
      toAbsolutePath('/skills/my-skill/big.png'),
    )

    // Assert
    expect(result).toBeNull()
  })

  test('returns nothing when the image cannot be read', async () => {
    // Arrange
    mockStat({}, 2)
    mockFs.readFile.mockRejectedValue(new Error('EACCES'))

    // Act
    const result = await readBinaryFile(
      toAbsolutePath('/skills/my-skill/locked.png'),
    )

    // Assert
    expect(result).toBeNull()
  })

  test('produces a base64 payload past the data-URL prefix for a tiny image', async () => {
    // Arrange
    mockStat({}, 3)
    mockFs.readFile.mockResolvedValue(Buffer.from([1, 2, 3]))

    // Act
    const result = await readBinaryFile(
      toAbsolutePath('/skills/my-skill/tiny.png'),
    )

    // Assert
    // 3 bytes -> 4 base64 chars
    expect(result!.dataUrl.length).toBeGreaterThan(
      'data:image/png;base64,'.length,
    )
  })
})
