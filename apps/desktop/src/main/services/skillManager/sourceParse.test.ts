import { describe, expect, test } from 'vitest'

import { parseSource } from './sourceParse'

/**
 * Unit tests for the source parser — user-typed input shapes in, structured
 * sources or dialog-safe rejections out. Every expectation is hard-coded
 * because these strings ARE the compatibility surface with the CLI.
 */
describe('parseSource', () => {
  test('parses owner/repo shorthand into a github source', () => {
    // Act
    const result = parseSource('vercel-labs/agent-skills')

    // Assert
    expect(result).toEqual({
      ok: true,
      source: {
        type: 'github',
        owner: 'vercel-labs',
        repo: 'agent-skills',
        ownerRepo: 'vercel-labs/agent-skills',
        url: 'https://github.com/vercel-labs/agent-skills.git',
      },
    })
  })

  test('strips a .git suffix from the repo segment', () => {
    // Act
    const result = parseSource('vercel-labs/agent-skills.git')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { repo: 'agent-skills', ownerRepo: 'vercel-labs/agent-skills' },
    })
  })

  test('carries the @skill suffix as a skill filter', () => {
    // Act
    const result = parseSource('vercel-labs/agent-skills@find-skills')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: {
        type: 'github',
        ownerRepo: 'vercel-labs/agent-skills',
        skillFilter: 'find-skills',
      },
    })
  })

  test('carries a repo-relative subpath from extended shorthand', () => {
    // Act
    const result = parseSource('vercel-labs/agent-skills/skills/curated')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { subpath: 'skills/curated' },
    })
  })

  test('parses a plain github.com URL', () => {
    // Act
    const result = parseSource('https://github.com/vercel-labs/agent-skills')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: {
        type: 'github',
        owner: 'vercel-labs',
        repo: 'agent-skills',
      },
    })
  })

  test('parses a /tree/<ref>/<subpath> URL into ref and subpath', () => {
    // Act
    const result = parseSource(
      'https://github.com/vercel-labs/agent-skills/tree/main/skills/react',
    )

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { ref: 'main', subpath: 'skills/react' },
    })
  })

  test('carries a #ref fragment when no subpath ref exists', () => {
    // Act
    const result = parseSource('vercel-labs/agent-skills#v1.2.3')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { ref: 'v1.2.3' },
    })
  })

  test('carries a #ref@skill fragment pair', () => {
    // Act
    const result = parseSource('vercel-labs/agent-skills#v1.2.3@find-skills')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { ref: 'v1.2.3', skillFilter: 'find-skills' },
    })
  })

  test('a URL subpath ref wins over the fragment ref like the CLI', () => {
    // Act
    const result = parseSource(
      'https://github.com/acme/skills/tree/main/sub/dir#ignored-ref',
    )

    // Assert — the fragment still lands as a ref only when the URL has none;
    // here the tree ref is authoritative and the fragment ref must not win.
    expect(result).toMatchObject({
      ok: true,
      source: { ref: 'main', subpath: 'sub/dir' },
    })
  })

  test('rewrites the CLI aliases verbatim for lock compatibility', () => {
    // Act
    const result = parseSource('vercel-labs/vercel-skills')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { ownerRepo: 'vercel-labs/agent-skills' },
    })
  })

  test('strips the github: prefix the CLI re-entered its parser with', () => {
    // Act
    const result = parseSource('github:acme/tools')

    // Assert
    expect(result).toMatchObject({
      ok: true,
      source: { ownerRepo: 'acme/tools' },
    })
  })

  test('treats an absolute path as a local source', () => {
    // Act
    const result = parseSource('/tmp/some/checkout')

    // Assert
    expect(result).toEqual({
      ok: true,
      source: {
        type: 'local',
        localPath: '/tmp/some/checkout',
        url: '/tmp/some/checkout',
      },
    })
  })

  test('expands a leading tilde against the process home directory', () => {
    // Act
    const result = parseSource('~/skills-checkout')

    // Assert — no shell ever sees this input, so the parser expands it itself.
    expect(result.ok).toBe(true)
    if (result.ok && result.source.type === 'local') {
      expect(result.source.localPath).not.toContain('~')
      expect(result.source.localPath.endsWith('/skills-checkout')).toBe(true)
    } else {
      throw new Error('expected a local source')
    }
  })

  test('resolves a relative ./ path against the process cwd', () => {
    // Act
    const result = parseSource('./local-dir')

    // Assert
    expect(result.ok).toBe(true)
    if (result.ok && result.source.type === 'local') {
      expect(result.source.localPath.endsWith('/local-dir')).toBe(true)
      expect(result.source.localPath.startsWith('/')).toBe(true)
    } else {
      throw new Error('expected a local source')
    }
  })

  test('keeps a malformed percent-escaped fragment verbatim instead of crashing', () => {
    // Arrange — `%zz` is not valid percent-encoding; the decoder must tolerate it.

    // Act
    const result = parseSource('owner/repo#%zz')

    // Assert — the raw fragment survives as the ref.
    expect(result).toEqual({
      ok: true,
      source: expect.objectContaining({ type: 'github', ref: '%zz' }),
    })
  })

  test('rejects an http-looking input that is not a parseable URL', () => {
    // Arrange — passes the https?:// prefix test, then `new URL` throws on it.
    const input = 'http://[::1'

    // Act
    const result = parseSource(input)

    // Assert
    expect(result).toEqual({
      ok: false,
      error: `Unsupported source type: ${input}`,
      userMessage:
        'This source type is not supported. Use a GitHub repository ' +
        '(owner/repo or a github.com URL) or a local directory path.',
    })
  })

  test('decodes percent-encoded subpath segments from a browser-copied tree URL', () => {
    // Arrange — GitHub renders spaces in directory names as %20 in the URL.

    // Act
    const result = parseSource(
      'https://github.com/acme/tools/tree/main/skills/My%20Skill',
    )

    // Assert — discovery must look for the real on-disk directory name.
    expect(result).toEqual({
      ok: true,
      source: expect.objectContaining({
        type: 'github',
        ref: 'main',
        subpath: 'skills/My Skill',
      }),
    })
  })

  test('keeps a malformed percent-encoded subpath segment verbatim instead of crashing', () => {
    // Arrange — `%zz` is not valid percent-encoding. (A well-formed encoded
    // traversal like %2E%2E never reaches the validator: `new URL` resolves
    // dot segments while normalizing the pathname.)

    // Act
    const result = parseSource(
      'https://github.com/acme/tools/tree/main/skills/%zz',
    )

    // Assert — the segment survives undecoded rather than throwing.
    expect(result).toEqual({
      ok: true,
      source: expect.objectContaining({
        type: 'github',
        subpath: 'skills/%zz',
      }),
    })
  })

  test('rejects gitlab URLs with a dialog-safe message', () => {
    // Act
    const result = parseSource('https://gitlab.com/acme/skills')

    // Assert
    expect(result).toEqual({
      ok: false,
      error: 'Unsupported source type: https://gitlab.com/acme/skills',
      userMessage:
        'This source type is not supported. Use a GitHub repository ' +
        '(owner/repo or a github.com URL) or a local directory path.',
    })
  })

  test('rejects scp-style ssh URLs', () => {
    // Act
    const result = parseSource('git@github.com:acme/skills.git')

    // Assert
    expect(result.ok).toBe(false)
  })

  test('rejects a bare repo name with no owner segment', () => {
    // Act
    const result = parseSource('just-a-name')

    // Assert
    expect(result.ok).toBe(false)
  })

  test('rejects github.com non-repo pages instead of cloning the whole repo', () => {
    // Act — the CLI's loose regexes would have cloned the repo for a /blob
    // URL; the port reports it so a pasted browser URL fails honestly.
    const result = parseSource(
      'https://github.com/acme/skills/blob/main/SKILL.md',
    )

    // Assert
    expect(result.ok).toBe(false)
  })

  test('rejects subpaths that escape the repo with a traversal-specific message', () => {
    // Act
    const result = parseSource('acme/skills/../../etc')

    // Assert
    expect(result).toEqual({
      ok: false,
      error: 'Unsafe subpath: "../../etc" contains path traversal segments.',
      userMessage:
        'The source path is not safe to install from. ' +
        'Remove any ".." segments and try again.',
    })
  })

  test('does not treat a hash inside a local path as a fragment', () => {
    // Act — '/tmp/hash#dir' is a legal directory name; fragment parsing must
    // never apply to local inputs.
    const result = parseSource('/tmp/hash#dir')

    // Assert
    expect(result).toEqual({
      ok: true,
      source: {
        type: 'local',
        localPath: '/tmp/hash#dir',
        url: '/tmp/hash#dir',
      },
    })
  })
})
