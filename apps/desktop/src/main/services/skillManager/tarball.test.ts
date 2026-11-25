import { describe, expect, test } from 'vitest'

import { parseUstar, stripSharedTopLevelDir } from './tarball'

/**
 * Unit tests for the ustar reader — hand-built buffers covering the shapes
 * codeload emits plus the hostile shapes a malicious archive could carry.
 * The writer helpers here deliberately build headers byte-by-byte: if the
 * fixture and the parser shared an abstraction, a bug in it would cancel out.
 */

function writeOctal(
  block: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  const octal = value.toString(8).padStart(length - 1, '0')
  block.write(octal, offset, length - 1, 'ascii')
  block[offset + length - 1] = 0
}

interface HeaderOptions {
  name: string
  typeflag: string
  size: number
  mode?: number
  prefix?: string
}

function header({
  name,
  typeflag,
  size,
  mode = 0o644,
  prefix,
}: HeaderOptions): Buffer {
  const block = Buffer.alloc(512)
  block.write(name, 0, Math.min(name.length, 100), 'latin1')
  writeOctal(block, mode, 100, 8)
  writeOctal(block, 0, 108, 8)
  writeOctal(block, 0, 116, 8)
  writeOctal(block, size, 124, 12)
  writeOctal(block, 1700000000, 136, 12)
  block.write(typeflag, 156, 1, 'ascii')
  if (prefix !== undefined) {
    block.write('ustar', 257, 'ascii')
    block.write('00', 263, 'ascii')
    block.write(prefix, 345, Math.min(prefix.length, 155), 'latin1')
  }
  return block
}

function padded(content: Buffer): Buffer {
  const padding = (512 - (content.length % 512)) % 512
  return padding > 0 ? Buffer.concat([content, Buffer.alloc(padding)]) : content
}

function tarOf(parts: Buffer[]): Buffer {
  return Buffer.concat([...parts, Buffer.alloc(1024)])
}

function filePart(name: string, content: string, mode?: number): Buffer[] {
  const body = Buffer.from(content, 'utf-8')
  return [
    header({
      name,
      typeflag: '0',
      size: body.length,
      ...(mode ? { mode } : {}),
    }),
    padded(body),
  ]
}

describe('parseUstar', () => {
  test('reads a regular file with its mode bits and content', () => {
    // Arrange
    const tar = tarOf(filePart('hello.txt', 'hi there', 0o640))

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('hello.txt')
    expect(entries[0].type).toBe('file')
    expect(entries[0].mode).toBe(0o640)
    expect(entries[0].content.toString('utf-8')).toBe('hi there')
  })

  test('reads directory entries as directories', () => {
    // Arrange
    const tar = tarOf([header({ name: 'subdir/', typeflag: '5', size: 0 })])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries).toEqual([
      {
        path: 'subdir/',
        type: 'directory',
        mode: 0o644,
        content: Buffer.alloc(0),
      },
    ])
  })

  test('joins the ustar prefix field onto long names', () => {
    // Arrange — a 130-byte path codeload would split across prefix+name.
    const longName = 'a'.repeat(60)
    const prefix = 'repo-main/' + 'b'.repeat(80)
    const body = Buffer.from('x')
    const tar = tarOf([
      header({ name: longName, typeflag: '0', size: 1, prefix }),
      padded(body),
    ])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries[0].path).toBe(`${prefix}/${longName}`)
  })

  test('lets a pax path header override the entry name', () => {
    // Arrange — pax extended header carrying a 110-char path.
    const longPath = 'repo-main/' + 'deep/'.repeat(20) + 'file.md'
    const record = `${longPath.length + 7} path=${longPath}\n`
    // pax record lengths are self-inclusive; pad the digit count honestly.
    let length = record.length
    for (;;) {
      const fixed = `${length} path=${longPath}\n`
      if (fixed.length === length) break
      length = fixed.length
    }
    const paxContent = Buffer.from(`${length} path=${longPath}\n`, 'utf-8')
    const body = Buffer.from('content')
    const tar = tarOf([
      header({ name: 'pax-header', typeflag: 'x', size: paxContent.length }),
      padded(paxContent),
      header({ name: 'short', typeflag: '0', size: body.length }),
      padded(body),
    ])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries[0].path).toBe(longPath)
    expect(entries[0].content.toString()).toBe('content')
  })

  test('honors a GNU long-name block for the following entry', () => {
    // Arrange
    const longPath = 'repo-main/' + 'very-long/'.repeat(15) + 'skill.md'
    const body = Buffer.from('y')
    const tar = tarOf([
      header({
        name: '././@LongLink',
        typeflag: 'L',
        size: Buffer.byteLength(longPath),
      }),
      padded(Buffer.from(longPath, 'utf-8')),
      header({ name: 'truncated', typeflag: '0', size: 1 }),
      padded(body),
    ])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries[0].path).toBe(longPath)
  })

  test('skips symlink entries entirely', () => {
    // Arrange — links are deliberately unsupported; content must not appear.
    const tar = tarOf([
      header({ name: 'link', typeflag: '2', size: 0 }),
      ...filePart('real.txt', 'real'),
    ])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('real.txt')
  })

  test('drops entries that would escape the extraction root', () => {
    // Arrange — classic zip-slip shapes: dotdot and drive letter.
    const tar = tarOf([
      ...filePart('../../etc/passwd', 'evil'),
      ...filePart('C:/windows/evil', 'evil'),
      ...filePart('fine/ok.txt', 'fine'),
    ])

    // Act
    const entries = parseUstar(tar)

    // Assert — only the inert entry survives.
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('fine/ok.txt')
  })

  test('neutralizes absolute paths into relative ones by stripping the leading slashes', () => {
    // Arrange — some producers write `/foo` for `foo`; stripping keeps the
    // entry inside the root instead of dropping honest content.
    const tar = tarOf([...filePart('/abs/path.txt', 'x')])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('abs/path.txt')
  })

  test('drops entries with interior traversal segments', () => {
    // Arrange
    const tar = tarOf([...filePart('a/../../../b', 'evil')])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries).toHaveLength(0)
  })

  test('strips leading ./ segments and collapses interior dots', () => {
    // Arrange
    const tar = tarOf([...filePart('./dir/./file.txt', 'x')])

    // Act
    const entries = parseUstar(tar)

    // Assert
    expect(entries[0].path).toBe('dir/file.txt')
  })

  test('throws on an archive truncated inside entry data', () => {
    // Arrange — header promises 100 bytes, stream ends after 10.
    const head = header({ name: 'big.bin', typeflag: '0', size: 100 })
    const tar = Buffer.concat([head, Buffer.alloc(10)])

    // Act + Assert
    expect(() => parseUstar(tar)).toThrow(
      'Tar entry data extends past end of stream',
    )
  })
})

describe('parseUstar hostile shapes', () => {
  test('rejects a header whose octal size field carries non-octal bytes', () => {
    // Arrange — a hand-corrupted header: '9' is not a valid octal digit.
    const block = header({ name: 'evil.txt', typeflag: '0', size: 1 })
    block.write('9', 124, 1, 'ascii')
    const tar = tarOf([block, padded(Buffer.from('x'))])

    // Act + Assert
    expect(() => parseUstar(tar)).toThrowError(
      expect.objectContaining({
        userMessage:
          'The repository archive is corrupt or uses an unsupported format.',
      }),
    )
  })

  test('stops parsing an octal field at padding that follows the digits', () => {
    // Arrange — GNU-style space padding: leading spaces, digits, then NULs.
    // The parser must terminate the number at the first pad byte AFTER the
    // digits rather than reading zeros as more octal.
    const block = header({ name: 'padded.txt', typeflag: '0', size: 0 })
    // Overwrite the size field (offset 124, length 12) with spaces + '7'.
    for (let i = 124; i < 136; i++) block[i] = 0x20
    block.write('7', 133, 1, 'ascii')
    block[134] = 0
    block[135] = 0
    const tar = tarOf([block, padded(Buffer.from('1234567'))])

    // Act
    const entries = parseUstar(tar)

    // Assert — size parsed as exactly 7, so the content is the full string.
    expect(entries).toHaveLength(1)
    expect(entries[0].content.toString('utf-8')).toBe('1234567')
  })

  test('rejects an archive with more entries than the extraction ceiling', () => {
    // Arrange — 8193 empty files: one past the 8192-entry ceiling.
    const parts: Buffer[] = []
    for (let i = 0; i < 8193; i++) {
      parts.push(header({ name: `f${i}.txt`, typeflag: '0', size: 0 }))
    }
    const tar = tarOf(parts)

    // Act + Assert
    expect(() => parseUstar(tar)).toThrowError(
      expect.objectContaining({
        userMessage:
          'The repository archive has too many files to install safely.',
      }),
    )
  })
})

describe('stripSharedTopLevelDir', () => {
  test('removes the single shared first component codeload wraps everything in', () => {
    // Arrange
    const entries = [
      {
        path: 'repo-main/skills/a/SKILL.md',
        type: 'file' as const,
        mode: 0o644,
        content: Buffer.from('x'),
      },
      {
        path: 'repo-main/README.md',
        type: 'file' as const,
        mode: 0o644,
        content: Buffer.from('y'),
      },
    ]

    // Act
    const stripped = stripSharedTopLevelDir(entries)

    // Assert
    expect(stripped.map((entry) => entry.path)).toEqual([
      'skills/a/SKILL.md',
      'README.md',
    ])
  })

  test('drops the top-level directory entry itself when it strips to nothing', () => {
    // Arrange
    const entries = [
      {
        path: 'repo-main',
        type: 'directory' as const,
        mode: 0o755,
        content: Buffer.alloc(0),
      },
      {
        path: 'repo-main/file',
        type: 'file' as const,
        mode: 0o644,
        content: Buffer.from('x'),
      },
    ]

    // Act
    const stripped = stripSharedTopLevelDir(entries)

    // Assert
    expect(stripped.map((entry) => entry.path)).toEqual(['file'])
  })

  test('leaves flat archives with mixed first components untouched', () => {
    // Arrange — hand-built tarballs are allowed to be flat.
    const entries = [
      {
        path: 'one/file',
        type: 'file' as const,
        mode: 0o644,
        content: Buffer.from('x'),
      },
      {
        path: 'two/file',
        type: 'file' as const,
        mode: 0o644,
        content: Buffer.from('y'),
      },
    ]

    // Act
    const stripped = stripSharedTopLevelDir(entries)

    // Assert
    expect(stripped.map((entry) => entry.path)).toEqual([
      'one/file',
      'two/file',
    ])
  })
})
