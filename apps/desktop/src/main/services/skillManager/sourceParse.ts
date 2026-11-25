import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

/**
 * Source parsing for the skill manager — a GitHub-and-local-only port of the
 * skills CLI's `parseSource` (v1.7.4). Everything the CLI would dispatch to
 * gitlab/ssh/git/well-known/download/notion is a structured unsupported-source
 * error here, because the in-process implementation deliberately has no git
 * binary to fall back on (see docs/adr/0003).
 *
 * Internal to `skillManager/` — not part of the module's public interface.
 */

/** A GitHub source the manager can fetch as a codeload tarball. */
export interface GitHubSource {
  type: 'github'
  /** Owner segment exactly as typed (case preserved). @example "vercel-labs" */
  owner: string
  /** Repo segment with any `.git` suffix stripped. @example "agent-skills" */
  repo: string
  /** `owner/repo` shorthand recorded in the lock entry's `source` field. */
  ownerRepo: string
  /** Canonical clone URL recorded in the lock entry's `sourceUrl` field. */
  url: string
  /** Git ref (branch/tag/sha) when the user pinned one. */
  ref?: string
  /** Repo-relative subdirectory the skill search is scoped to. */
  subpath?: string
  /** Skill filter carried by an `@skill` fragment or shorthand suffix. */
  skillFilter?: string
}

/** A local directory source installed by copying, with no network access. */
export interface LocalSource {
  type: 'local'
  /** Absolute resolved path to the source directory. */
  localPath: string
  /** Same as `localPath`; mirrors the CLI's lock `sourceUrl` for local sources. */
  url: string
}

export type ParsedSource = GitHubSource | LocalSource

/**
 * Outcome of parsing one source string. Parse never throws: user-typed input
 * is data, and every rejection carries a UI-safe `userMessage`.
 */
export type ParseSourceResult =
  | { ok: true; source: ParsedSource }
  | { ok: false; error: string; userMessage: string }

/** Aliases the CLI rewrites before parsing, ported for lock compatibility. */
const SOURCE_ALIASES: Record<string, string> = {
  'coinbase/agentWallet': 'coinbase/agentic-wallet-skills',
  'vercel-labs/vercel-skills': 'vercel-labs/agent-skills',
}

/**
 * True for inputs the CLI treats as local filesystem paths: absolute paths,
 * `./`/`../` prefixes, the bare `.`/`..` tokens, and Windows drive letters.
 * The manager additionally expands `~` — a shell would do that for the CLI,
 * but no shell ever sees this input in-process.
 */
function isLocalPathInput(input: string): boolean {
  return (
    isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    input === '~' ||
    input.startsWith('~/') ||
    /^[a-zA-Z]:[/\\]/.test(input)
  )
}

/** Expand a leading `~` against the process home directory. */
function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return homedir() + input.slice(1)
  return input
}

/**
 * Reject `..` traversal segments in a repo-relative subpath, mirroring the
 * CLI's `sanitizeSubpath`. Backslashes count as separators because a Windows
 * checkout would treat them as one.
 * @throws Error when any segment is exactly `..`
 */
function sanitizeSubpath(subpath: string): string {
  const segments = subpath.replace(/\\/g, '/').split('/')
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(
        `Unsafe subpath: "${subpath}" contains path traversal segments.`,
      )
    }
  }
  return subpath
}

/** decodeURIComponent that tolerates malformed escapes in user input. */
function decodeFragmentValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

interface FragmentParts {
  inputWithoutFragment: string
  ref?: string
  skillFilter?: string
}

/**
 * Split a trailing `#ref` / `#ref@skill` / `#@skill` fragment off the input.
 * The fragment only counts when what precedes it still looks like a git
 * source — a `#` inside a local path is just a filename character.
 */
function parseFragmentRef(input: string): FragmentParts {
  const hashIndex = input.indexOf('#')
  if (hashIndex < 0) return { inputWithoutFragment: input }
  const inputWithoutFragment = input.slice(0, hashIndex)
  const fragment = input.slice(hashIndex + 1)
  // A fragment on nothing, or on something that cannot be a repo, is noise.
  if (!fragment || !inputWithoutFragment) return { inputWithoutFragment: input }
  const atIndex = fragment.indexOf('@')
  if (atIndex === -1) {
    return { inputWithoutFragment, ref: decodeFragmentValue(fragment) }
  }
  const ref = fragment.slice(0, atIndex)
  const skillFilter = fragment.slice(atIndex + 1)
  return {
    inputWithoutFragment,
    ref: ref ? decodeFragmentValue(ref) : undefined,
    skillFilter: skillFilter ? decodeFragmentValue(skillFilter) : undefined,
  }
}

function unsupported(input: string): ParseSourceResult {
  return {
    ok: false,
    error: `Unsupported source type: ${input}`,
    userMessage:
      'This source type is not supported. Use a GitHub repository ' +
      '(owner/repo or a github.com URL) or a local directory path.',
  }
}

/**
 * Parse a github.com URL path into owner/repo[/tree/ref/subpath] parts.
 * Returns null when the path is not a repo or tree URL the manager supports.
 * Deliberately stricter than the CLI's substring regexes: blob/issues/wiki
 * pages are reported as unsupported instead of silently cloning the repo.
 */
function parseGitHubUrlPath(pathname: string): {
  owner: string
  repo: string
  ref?: string
  subpath?: string
} | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const [owner, rawRepo] = segments
  const repo = rawRepo.replace(/\.git$/, '')
  if (!owner || !repo) return null
  if (segments.length === 2) return { owner, repo }
  if (segments[2] !== 'tree' || segments.length < 4) return null
  const ref = segments[3]
  const subpathSegments = segments.slice(4)
  return {
    owner,
    repo,
    ref,
    ...(subpathSegments.length > 0
      ? { subpath: sanitizeSubpath(subpathSegments.join('/')) }
      : {}),
  }
}

function githubSource(
  owner: string,
  repo: string,
  extras: {
    ref?: string
    subpath?: string
    skillFilter?: string
    fragmentRef?: string
    fragmentSkillFilter?: string
  },
): GitHubSource {
  const ref = extras.ref ?? extras.fragmentRef
  const skillFilter = extras.fragmentSkillFilter ?? extras.skillFilter
  return {
    type: 'github',
    owner,
    repo,
    ownerRepo: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}.git`,
    ...(ref ? { ref } : {}),
    ...(extras.subpath ? { subpath: extras.subpath } : {}),
    ...(skillFilter ? { skillFilter } : {}),
  }
}

/**
 * Parse one source string into a fetchable/copyable source description.
 * Called by {@link installSkills} before any network or filesystem work.
 * GitHub shorthand (`owner/repo`, `@skill` suffixes, `#ref` fragments),
 * github.com URLs (including `/tree/<ref>/<subpath>`), and local directory
 * paths are supported; every other shape is a structured rejection.
 * @param input - Source exactly as the user or the marketplace supplied it.
 * @returns The parsed source, or a rejection whose `userMessage` is UI-safe.
 * @example parseSource('vercel-labs/agent-skills') // => { ok: true, source: { type: 'github', owner: 'vercel-labs', ... } }
 * @example parseSource('https://gitlab.com/a/b') // => { ok: false, ... }
 */
export function parseSource(input: string): ParseSourceResult {
  // Local paths never carry fragments or aliases — the CLI checks them first.
  if (isLocalPathInput(input)) {
    const resolvedPath = resolve(expandHome(input))
    return {
      ok: true,
      source: { type: 'local', localPath: resolvedPath, url: resolvedPath },
    }
  }

  try {
    const {
      inputWithoutFragment,
      ref: fragmentRef,
      skillFilter: fragmentSkillFilter,
    } = parseFragmentRef(input)
    let body = inputWithoutFragment

    const alias = SOURCE_ALIASES[body]
    if (alias) body = alias

    // The `github:` prefix simply re-entered the parser in the CLI; inline it.
    const githubPrefixMatch = body.match(/^github:(.+)$/)
    if (githubPrefixMatch) body = githubPrefixMatch[1]

    // Full URLs: only github.com is in scope.
    if (/^https?:\/\//.test(body)) {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(body)
      } catch {
        return unsupported(input)
      }
      if (parsedUrl.hostname !== 'github.com') return unsupported(input)
      const parts = parseGitHubUrlPath(
        parsedUrl.pathname.replace(/\/+$/, '') || '/',
      )
      if (!parts) return unsupported(input)
      return {
        ok: true,
        source: githubSource(parts.owner, parts.repo, {
          ref: parts.ref,
          subpath: parts.subpath,
          fragmentRef,
          fragmentSkillFilter,
        }),
      }
    }

    // Scp-style/ssh/git URLs and other hosts are out of scope.
    if (body.includes(':')) return unsupported(input)

    // Shorthand: owner/repo@skill, then owner/repo[/sub/path].
    const atSkillMatch = body.match(/^([^/]+)\/([^/@]+)@(.+)$/)
    if (atSkillMatch && !body.startsWith('.') && !body.startsWith('/')) {
      const [, owner, repo, skillFilter] = atSkillMatch
      return {
        ok: true,
        source: githubSource(owner, repo.replace(/\.git$/, ''), {
          fragmentRef,
          fragmentSkillFilter,
          skillFilter,
        }),
      }
    }

    const shorthandMatch = body.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/)
    if (shorthandMatch && !body.startsWith('.') && !body.startsWith('/')) {
      const [, owner, repo, subpath] = shorthandMatch
      return {
        ok: true,
        source: githubSource(owner, repo.replace(/\.git$/, ''), {
          fragmentRef,
          fragmentSkillFilter,
          subpath: subpath ? sanitizeSubpath(subpath) : undefined,
        }),
      }
    }

    return unsupported(input)
  } catch (error) {
    // sanitizeSubpath throws on `..` traversal; surface it as a rejection.
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      userMessage:
        'The source path is not safe to install from. ' +
        'Remove any ".." segments and try again.',
    }
  }
}
