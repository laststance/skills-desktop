import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import {
  AZURE_SKILLS_REPO,
  AZURE_SKILL_NAMES,
  FIXED_FIXTURE_TIMESTAMP,
  FIXED_FIXTURE_TOUCH_STAMP,
  NPM_CACHE_DIR,
  SKILLS_CLI_VERSION,
  SNAPSHOT_FIXTURE_META,
  SNAPSHOT_FIXTURE_TARBALL,
  SNAPSHOT_LOCK_FILE,
  UNIVERSAL_SOURCE_SEGMENT,
} from '../constants'

/**
 * Provenance recorded next to the committed snapshot tarball. global-setup
 * compares this against the live constants to decide whether the cached
 * fixture still matches what a fresh install would produce.
 */
interface FixtureMeta {
  cliVersion: string
  repo: string
  skillNames: readonly string[]
}

/** Top-level HOME dirs that hold transient caches, never agent→skill symlinks. */
const NON_SNAPSHOT_DIRS = new Set([NPM_CACHE_DIR, '.cache'])

/**
 * Resolve an e2e-root-relative path (constants store paths relative to e2e/).
 * @param relativePath - Path relative to the `e2e/` directory.
 * @returns The absolute path under `e2e/`.
 * @example e2ePath('fixtures/azure-skills-snapshot.tar.gz') // => '/…/e2e/fixtures/azure-skills-snapshot.tar.gz'
 */
function e2ePath(relativePath: string): string {
  return resolve(__dirname, '..', relativePath)
}

/**
 * The snapshot's provenance: the inputs that determine its contents. Drift in
 * any field means the committed fixture no longer matches a live install.
 * @returns The `{cliVersion, repo, skillNames}` triple from the live constants.
 * @example currentFixtureMeta() // => { cliVersion: '1.5.1', repo: 'microsoft/azure-skills', skillNames: [...] }
 */
function currentFixtureMeta(): FixtureMeta {
  return {
    cliVersion: SKILLS_CLI_VERSION,
    repo: AZURE_SKILLS_REPO,
    skillNames: AZURE_SKILL_NAMES,
  }
}

/**
 * Whether the committed fixture exists AND its recorded provenance matches the
 * current constants — i.e. the cache is safe to use instead of a live install.
 * Any missing/corrupt/mismatched state returns false so global-setup falls back
 * to a live install rather than untarring a stale tree.
 * @returns
 * - `true` when tarball + meta both exist and meta deep-equals the live constants
 * - `false` on any missing file, parse error, or provenance mismatch
 * @example isCommittedFixtureUsable() // => true on a clean checkout matching constants
 */
export function isCommittedFixtureUsable(): boolean {
  const tarballPath = e2ePath(SNAPSHOT_FIXTURE_TARBALL)
  const metaPath = e2ePath(SNAPSHOT_FIXTURE_META)
  if (!existsSync(tarballPath) || !existsSync(metaPath)) return false
  try {
    const recorded = JSON.parse(readFileSync(metaPath, 'utf-8')) as FixtureMeta
    const current = currentFixtureMeta()
    const sameSkills =
      recorded.skillNames.length === current.skillNames.length &&
      current.skillNames.every(
        (name, index) => recorded.skillNames[index] === name,
      )
    return (
      recorded.cliVersion === current.cliVersion &&
      recorded.repo === current.repo &&
      sameSkills
    )
  } catch (err) {
    console.warn('[e2e:setup] fixture meta unreadable; will live-install', err)
    return false
  }
}

/**
 * Extract the committed snapshot tarball into a snapshot HOME (hermetic, no
 * network). Symlinks in the tarball are already HOME-relative, so they resolve
 * within whichever HOME they land in.
 * @param home - Snapshot HOME root to populate.
 * @returns Nothing; populates `home` in place from the committed tarball.
 * @example restoreCommittedFixture('/tmp/skills-desktop-e2e-snapshot-abc')
 */
export function restoreCommittedFixture(home: string): void {
  execFileSync('tar', ['-xzf', e2ePath(SNAPSHOT_FIXTURE_TARBALL), '-C', home], {
    stdio: 'inherit',
  })
}

/**
 * Re-anchor a single symlink to be HOME-relative by its universal-source
 * suffix, NOT by resolving its (possibly install-baked) absolute target — that
 * resolve-then-reanchor approach is the exact path-baking trap that breaks when
 * the tree is later unpacked at a different HOME.
 * @param link - Absolute path to the symlink to rewrite.
 * @param home - HOME root the new relative target should resolve within.
 * @returns `true` if the link was rewritten, `false` if it points outside the universal source.
 * @example reanchorSymlink('/tmp/snap/.claude/skills/azure-ai', '/tmp/snap') // => true (target → ../../.agents/skills/azure-ai)
 */
function reanchorSymlink(link: string, home: string): boolean {
  const rawTarget = readlinkSync(link)
  const suffixStart = rawTarget.lastIndexOf(UNIVERSAL_SOURCE_SEGMENT)
  if (suffixStart === -1) return false
  const sourceRelative = rawTarget.slice(suffixStart) // e.g. ".agents/skills/azure-ai"
  const newTarget = relative(dirname(link), join(home, sourceRelative))
  if (newTarget === rawTarget) return false
  unlinkSync(link)
  symlinkSync(newTarget, link)
  return true
}

/**
 * Rewrite every agent→skill symlink under a snapshot HOME to a HOME-relative
 * target so the tree is self-contained and survives being tarred/untarred or
 * hardlink-copied into a different HOME. Idempotent.
 * @param home - Snapshot HOME root to normalize.
 * @returns Count of symlinks rewritten (0 if already normalized).
 * @example normalizeSnapshotSymlinks('/tmp/snap') // => 217
 */
export function normalizeSnapshotSymlinks(home: string): number {
  let rewritten = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (dir === home && NON_SNAPSHOT_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        if (reanchorSymlink(full, home)) rewritten++
      } else if (entry.isDirectory()) {
        walk(full)
      }
    }
  }
  walk(home)
  return rewritten
}

/**
 * Pin the lock file's per-skill `installedAt`/`updatedAt` to a fixed instant so
 * a regenerated fixture is byte-reproducible (the content-derived
 * `skillFolderHash` is left untouched). No-op when the lock is absent.
 * @param home - Snapshot HOME root whose `.agents/.skill-lock.json` is rewritten.
 * @returns Nothing; rewrites the lock file in place (no-op when absent).
 * @example normalizeLockTimestamps('/tmp/snap') // pins every skill's installedAt/updatedAt to 2020-01-01
 */
function normalizeLockTimestamps(home: string): void {
  const lockPath = join(home, SNAPSHOT_LOCK_FILE)
  if (!existsSync(lockPath)) return
  const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
    skills?: Record<string, { installedAt?: string; updatedAt?: string }>
  }
  for (const entry of Object.values(lock.skills ?? {})) {
    entry.installedAt = FIXED_FIXTURE_TIMESTAMP
    entry.updatedAt = FIXED_FIXTURE_TIMESTAMP
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
}

/**
 * Capture a live-installed snapshot HOME into the committed fixture: normalize
 * symlinks + lock + file mtimes for reproducibility, drop the transient npm
 * cache, then write a deterministic gzip tarball plus its provenance sidecar.
 * Run via `pnpm gen:e2e-snapshot` whenever the CLI version or skill set changes.
 * @param home - Snapshot HOME produced by a live `installAzureSkills` run.
 * @returns Nothing; writes the tarball + meta sidecar under `e2e/fixtures/`.
 * @example captureCommittedFixture('/tmp/skills-desktop-e2e-snapshot-abc')
 */
export function captureCommittedFixture(home: string): void {
  normalizeSnapshotSymlinks(home)
  normalizeLockTimestamps(home)
  // Drop the npm cache npx leaves under HOME — transient, ~2.5MB, never asserted.
  rmSync(join(home, NPM_CACHE_DIR), { recursive: true, force: true })
  // Pin every entry's mtime (symlinks included via -h) so the tar headers don't
  // churn between regenerations of otherwise-identical content.
  execFileSync('find', [
    home,
    '-exec',
    'touch',
    '-h',
    '-t',
    FIXED_FIXTURE_TOUCH_STAMP,
    '{}',
    '+',
  ])

  const tarballPath = e2ePath(SNAPSHOT_FIXTURE_TARBALL)
  const stagingTarPath = `${tarballPath}.tar`
  // COPYFILE_DISABLE keeps macOS from injecting ._* AppleDouble entries; a
  // separate `gzip -n` strips the gzip header's name+mtime for a stable blob.
  execFileSync('tar', ['-cf', stagingTarPath, '-C', home, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  execFileSync('gzip', ['-nf', stagingTarPath])
  renameSync(`${stagingTarPath}.gz`, tarballPath)

  writeFileSync(
    e2ePath(SNAPSHOT_FIXTURE_META),
    `${JSON.stringify(currentFixtureMeta(), null, 2)}\n`,
  )
}
