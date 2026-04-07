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

  // Regression: deleting a "local" skill (a real folder living inside an agent
  // directory rather than under ~/.agents/skills/) used to throw
  // "Path traversal attempt detected" because SKILLS_DELETE validated the path
  // against [SOURCE_DIR] only. Validating against getAllowedBases() must accept
  // every agent's skills directory so local skills can be deleted.
  it('accepts a path inside any agent skills directory (local skill regression)', () => {
    const bases = getAllowedBases()
    // The first base is SOURCE_DIR; any other base is an agent skills dir
    const agentBase = bases[1]
    expect(agentBase).toBeDefined()
    const localSkillPath = `${agentBase}/playwright-cli`
    // Should NOT throw — the renderer hands us this path when the user clicks
    // the X (delete) button on a local skill in global view
    expect(() => validatePath(localSkillPath, bases)).not.toThrow()
  })

  it('rejects an agent-dir skill path when only SOURCE_DIR is allowed', () => {
    // This is the pre-fix behavior of SKILLS_DELETE — kept as a guard so we
    // never reintroduce "validatePath(skillPath, [SOURCE_DIR])" for delete.
    const bases = getAllowedBases()
    const sourceDir = bases[0]
    const agentBase = bases[1]
    const localSkillPath = `${agentBase}/playwright-cli`
    expect(() => validatePath(localSkillPath, [sourceDir])).toThrow(
      'Path traversal attempt detected',
    )
  })

  // Regression: SKILLS_UNLINK_FROM_AGENT used to validate against
  // AGENTS.map(a => a.path) only. Because validatePath calls realpathSync,
  // a symlinked agent skill at ~/.cursor/skills/foo resolves to its source
  // at ~/.agents/skills/foo (= SOURCE_DIR). SOURCE_DIR was NOT in agentBases,
  // so EVERY symlinked-skill unlink threw "Path traversal attempt detected"
  // and left state.skills.error stuck on the error view. The fix is to use
  // getAllowedBases() which includes SOURCE_DIR + every agent dir.
  it('accepts a SOURCE_DIR path when validating against getAllowedBases (symlink unlink regression)', () => {
    // Simulates what realpathSync returns for a symlinked agent skill: a path
    // inside SOURCE_DIR (the symlink target).
    const bases = getAllowedBases()
    const sourceDir = bases[0]
    const resolvedSymlinkTarget = `${sourceDir}/agent-browser`
    expect(() => validatePath(resolvedSymlinkTarget, bases)).not.toThrow()
  })

  it('rejects a SOURCE_DIR path when validating against agent paths only', () => {
    // Pre-fix behavior of SKILLS_UNLINK_FROM_AGENT — kept as a guard so we
    // never reintroduce "validatePath(linkPath, AGENTS.map(a => a.path))"
    // which fails for symlinked skills (realpath resolves them to SOURCE_DIR).
    const bases = getAllowedBases()
    const sourceDir = bases[0]
    const agentBasesOnly = bases.slice(1) // every base except SOURCE_DIR
    const resolvedSymlinkTarget = `${sourceDir}/agent-browser`
    expect(() => validatePath(resolvedSymlinkTarget, agentBasesOnly)).toThrow(
      'Path traversal attempt detected',
    )
  })
})
