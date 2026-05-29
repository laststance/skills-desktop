import { describe, expect, it } from 'vitest'

import { getAllowedBases, validatePath } from './pathValidation'

describe('validatePath', () => {
  const bases = ['/home/user/.agents/skills', '/home/user/.claude/skills']

  it('admits a file under the first allowed base', () => {
    // Arrange
    // bases declared above

    // Act
    const result = validatePath(
      '/home/user/.agents/skills/task/SKILL.md',
      bases,
    )

    // Assert
    expect(result).toBe('/home/user/.agents/skills/task/SKILL.md')
  })

  it('admits a file under the second allowed base', () => {
    // Arrange
    // bases declared above

    // Act
    const result = validatePath(
      '/home/user/.claude/skills/task/SKILL.md',
      bases,
    )

    // Assert
    expect(result).toBe('/home/user/.claude/skills/task/SKILL.md')
  })

  it('admits the base directory itself', () => {
    // Act
    const result = validatePath('/home/user/.agents/skills', bases)

    // Assert
    expect(result).toBe('/home/user/.agents/skills')
  })

  it('admits a deeply nested file inside a base', () => {
    // Act
    const result = validatePath(
      '/home/user/.agents/skills/task/src/utils/helper.ts',
      bases,
    )

    // Assert
    expect(result).toBe('/home/user/.agents/skills/task/src/utils/helper.ts')
  })

  it('rejects a ../ traversal that escapes a base', () => {
    // Act & Assert
    expect(() =>
      validatePath('/home/user/.agents/skills/../../../etc/passwd', bases),
    ).toThrow('Path traversal attempt detected')
  })

  it('rejects an unrelated absolute path', () => {
    // Act & Assert
    expect(() => validatePath('/etc/passwd', bases)).toThrow(
      'Path traversal attempt detected',
    )
  })

  it('rejects a path that lies outside every base', () => {
    // Act & Assert
    expect(() => validatePath('/home/user/.ssh/id_rsa', bases)).toThrow(
      'Path traversal attempt detected',
    )
  })

  it('rejects a sibling directory of an allowed base', () => {
    // Act & Assert
    expect(() =>
      validatePath('/home/user/.agents/config/secrets.json', bases),
    ).toThrow('Path traversal attempt detected')
  })

  it('rejects every path when the allowed-bases list is empty', () => {
    // Act & Assert
    expect(() => validatePath('/home/user/.agents/skills/task', [])).toThrow(
      'Path traversal attempt detected',
    )
  })

  it('collapses redundant separators before admitting a valid path', () => {
    // Act
    const result = validatePath(
      '/home/user/.agents/skills//task///SKILL.md',
      bases,
    )

    // Assert
    expect(result).toBe('/home/user/.agents/skills/task/SKILL.md')
  })

  // Regression: right-pane expansion (subdirectory recursion) sends deeper
  // paths through validatePath. This guards against accidentally tightening
  // the check in a way that blocks legitimate subpaths like `lib/helper.py`.
  it('allows a nested subpath inside an allowed base (subdirectory recursion regression)', () => {
    // Act
    const result = validatePath(
      '/home/user/.agents/skills/task/lib/sub/helper.py',
      bases,
    )

    // Assert
    expect(result).toBe('/home/user/.agents/skills/task/lib/sub/helper.py')
  })

  // Regression: the renderer sends the skill root + a relativePath. If we
  // ever joined these client-side without revalidation, a crafted relativePath
  // could escape. validatePath must still reject the fully-joined path.
  it('rejects a joined path that escapes via ..  (relativePath traversal regression)', () => {
    // Act & Assert
    // Simulates join(skillPath, relativePath) where relativePath is malicious.
    expect(() =>
      validatePath(
        '/home/user/.agents/skills/task/../../../../etc/passwd',
        bases,
      ),
    ).toThrow('Path traversal attempt detected')
  })

  // Regression: files:readBinary uses the same validatePath + getAllowedBases
  // as files:read. If someone introduces a parallel, looser validator for
  // binary files, this test must fail.
  it('rejects a binary file path outside all bases (files:readBinary regression)', () => {
    // Act & Assert
    expect(() => validatePath('/private/etc/shadow', bases)).toThrow(
      'Path traversal attempt detected',
    )
  })
})

describe('getAllowedBases', () => {
  it('exposes at least one allowed base directory', () => {
    // Act
    const bases = getAllowedBases()

    // Assert
    expect(bases.length).toBeGreaterThan(0)
  })

  it('lists the Universal source dir as the first allowed base', () => {
    // Act
    const bases = getAllowedBases()

    // Assert
    expect(bases[0]).toContain('.agents/skills')
  })

  it('includes agent skills directories alongside the source dir', () => {
    // Act
    const bases = getAllowedBases()

    // Assert
    // Should have at least SOURCE_DIR + some agents
    expect(bases.length).toBeGreaterThan(1)
  })

  // Regression: deleting a "local" skill (a real folder living inside an agent
  // directory rather than under ~/.agents/skills/) used to throw
  // "Path traversal attempt detected" because SKILLS_DELETE validated the path
  // against [SOURCE_DIR] only. Validating against getAllowedBases() must accept
  // every agent's skills directory so local skills can be deleted.
  it('accepts a path inside any agent skills directory (local skill regression)', () => {
    // Arrange
    const bases = getAllowedBases()
    // The first base is SOURCE_DIR; any other base is an agent skills dir
    const agentBase = bases[1]
    expect(agentBase).toBeDefined()
    const localSkillPath = `${agentBase}/playwright-cli`

    // Act & Assert
    // Should NOT throw — the renderer hands us this path when the user clicks
    // the X (delete) button on a local skill in global view
    expect(() => validatePath(localSkillPath, bases)).not.toThrow()
  })

  it('rejects an agent-dir skill path when only SOURCE_DIR is allowed', () => {
    // Arrange
    // This is the pre-fix behavior of SKILLS_DELETE — kept as a guard so we
    // never reintroduce "validatePath(skillPath, [SOURCE_DIR])" for delete.
    const bases = getAllowedBases()
    const sourceDir = bases[0]
    const agentBase = bases[1]
    // Use a deliberately non-existent skill name so realpathSync throws ENOENT
    // and the comparison stays in the literal-resolve coordinate system. If
    // we used a real skill name (e.g. "playwright-cli") and the dev had
    // symlinked it from agentBase into SOURCE_DIR locally, realpath would
    // resolve INTO SOURCE_DIR and the test would falsely pass.
    const nonExistentSkillName = '__validate_path_test_fixture_does_not_exist__'
    const localSkillPath = `${agentBase}/${nonExistentSkillName}`

    // Act & Assert
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
    // Arrange
    // Simulates what realpathSync returns for a symlinked agent skill: a path
    // inside SOURCE_DIR (the symlink target).
    const bases = getAllowedBases()
    const sourceDir = bases[0]
    const resolvedSymlinkTarget = `${sourceDir}/agent-browser`

    // Act & Assert
    expect(() => validatePath(resolvedSymlinkTarget, bases)).not.toThrow()
  })

  it('rejects a SOURCE_DIR path when validating against agent paths only', () => {
    // Arrange
    // Pre-fix behavior of SKILLS_UNLINK_FROM_AGENT — kept as a guard so we
    // never reintroduce "validatePath(linkPath, AGENTS.map(a => a.path))"
    // which fails for symlinked skills (realpath resolves them to SOURCE_DIR).
    const bases = getAllowedBases()
    const sourceDir = bases[0]
    const agentBasesOnly = bases.slice(1) // every base except SOURCE_DIR
    const resolvedSymlinkTarget = `${sourceDir}/agent-browser`

    // Act & Assert
    expect(() => validatePath(resolvedSymlinkTarget, agentBasesOnly)).toThrow(
      'Path traversal attempt detected',
    )
  })
})
