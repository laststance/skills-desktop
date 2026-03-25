import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getAllowedBases, validatePath } from './pathValidation'

describe('validatePath', () => {
  const bases = ['/home/user/.agents/skills', '/home/user/.claude/skills']

  it('allows path within first allowed base', () => {
    const result = validatePath(
      '/home/user/.agents/skills/task/SKILL.md',
      bases,
    )
    expect(result).toBe(resolve('/home/user/.agents/skills/task/SKILL.md'))
  })

  it('allows path within second allowed base', () => {
    const result = validatePath(
      '/home/user/.claude/skills/task/SKILL.md',
      bases,
    )
    expect(result).toBe(resolve('/home/user/.claude/skills/task/SKILL.md'))
  })

  it('allows exact base directory path', () => {
    const result = validatePath('/home/user/.agents/skills', bases)
    expect(result).toBe(resolve('/home/user/.agents/skills'))
  })

  it('allows deeply nested path within base', () => {
    const result = validatePath(
      '/home/user/.agents/skills/task/src/utils/helper.ts',
      bases,
    )
    expect(result).toBe(
      resolve('/home/user/.agents/skills/task/src/utils/helper.ts'),
    )
  })

  it('throws on path traversal with ../', () => {
    expect(() =>
      validatePath('/home/user/.agents/skills/../../../etc/passwd', bases),
    ).toThrow('Path traversal attempt detected')
  })

  it('throws on unrelated absolute path', () => {
    expect(() => validatePath('/etc/passwd', bases)).toThrow(
      'Path traversal attempt detected',
    )
  })

  it('throws on path outside all bases', () => {
    expect(() => validatePath('/home/user/.ssh/id_rsa', bases)).toThrow(
      'Path traversal attempt detected',
    )
  })

  it('throws on sibling directory', () => {
    expect(() =>
      validatePath('/home/user/.agents/config/secrets.json', bases),
    ).toThrow('Path traversal attempt detected')
  })

  it('throws on empty allowed bases', () => {
    expect(() => validatePath('/home/user/.agents/skills/task', [])).toThrow(
      'Path traversal attempt detected',
    )
  })

  it('normalizes path with redundant separators', () => {
    const result = validatePath(
      '/home/user/.agents/skills//task///SKILL.md',
      bases,
    )
    expect(result).toBe(resolve('/home/user/.agents/skills/task/SKILL.md'))
  })
})

describe('getAllowedBases', () => {
  it('returns non-empty array', () => {
    const bases = getAllowedBases()
    expect(bases.length).toBeGreaterThan(0)
  })

  it('includes SOURCE_DIR as first element', () => {
    const bases = getAllowedBases()
    expect(bases[0]).toContain('.agents/skills')
  })

  it('includes agent paths', () => {
    const bases = getAllowedBases()
    // Should have at least SOURCE_DIR + some agents
    expect(bases.length).toBeGreaterThan(1)
  })
})
