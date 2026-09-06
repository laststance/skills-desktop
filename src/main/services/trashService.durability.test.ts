import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { lstat, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import { tombstoneIdSchema } from '@/main/ipc/ipc-schemas'
import type { AbsolutePath, FilesystemEntryIdentity, SkillName } from '@/shared/types'

import { filesystemIdentityFromStats } from './filesystemIdentity'

// Same module-load stamping + realpath canonicalization as
// `trashService.integration.test.ts`: the mock factory has to capture a defined
// home before `trashService`'s top-level `TRASH_DIR` is computed, and
// `validatePath` resolves through `realpathSync`, so an uncanonicalized
// `/var/folders/...` would read as an escape from its own declared base.
const sharedHome = realpathSync(mkdtempSync(join(tmpdir(), 'skills-trash-dur-')))
const sharedSourceDir = join(sharedHome, '.agents', 'skills')
const sharedTrashDir = join(sharedHome, '.agents', '.trash')
const sharedAgentCursor = join(sharedHome, '.cursor', 'skills')

/**
 * Hooks the mocked `node:fs/promises` reads on every call. Hoisted so the
 * `vi.mock` factory can close over them, and armed per-test so setup writes in
 * Arrange never trip an observer meant for Act.
 */
const fsHooks = vi.hoisted(() => ({
  /** Runs just before each `manifest.json` write, inside the build window. */
  onManifestWrite: null as null | (() => Promise<void>),
  /** Rejects that write when set, to drive the publish-rollback arm. */
  failManifestWrite: false,
  /** Absolute destination whose `fs.cp` must fail, to strand the source. */
  failCopyToDestination: null as null | string,
  /** Rejects the publish rename when set, to drive its fallback arm. */
  failPublishRename: false,
}))

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => sharedHome }
})

// `../constants` reaches home through the bare `'os'` specifier, so the AGENTS
// table needs its own mock or agent paths still point at the real `~`.
vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => sharedHome }
})

// Everything delegates to the real filesystem; the wrappers only add an
// observation point inside `moveToTrash`'s build window and two opt-in
// failures. A durability claim about a crash window cannot be checked from
// outside that window.
vi.mock('node:fs/promises', async () => {
  const actual =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const writeFileSpy: typeof actual.writeFile = async (path, ...rest) => {
    if (String(path).endsWith('manifest.json') && fsHooks.onManifestWrite) {
      await fsHooks.onManifestWrite()
      if (fsHooks.failManifestWrite) {
        throw Object.assign(new Error('manifest write refused'), {
          code: 'EACCES',
        })
      }
    }
    return actual.writeFile(path, ...rest)
  }
  const copySpy: typeof actual.cp = async (source, destination, ...rest) => {
    if (destination === fsHooks.failCopyToDestination) {
      throw Object.assign(new Error('copy refused'), { code: 'EACCES' })
    }
    return actual.cp(source, destination, ...rest)
  }
  // Scoped to the publish rename by its destination shape: the same `rename`
  // moves the source into the staged entry, and failing that would abort long
  // before the arm under test.
  const renameSpy: typeof actual.rename = async (source, destination) => {
    if (
      fsHooks.failPublishRename &&
      tombstoneIdSchema.safeParse(basename(String(destination))).success
    ) {
      throw Object.assign(new Error('publish refused'), { code: 'EACCES' })
    }
    return actual.rename(source, destination)
  }
  return {
    ...actual,
    default: actual,
    writeFile: writeFileSpy,
    cp: copySpy,
    rename: renameSpy,
  }
})

// Imported AFTER the mocks so its module-level TRASH_DIR resolves under tmp.
const trashServicePromise = import('./trashService')

/**
 * Create a source skill with SKILL.md so `moveToTrash` has a real dir to move.
 * @param skillName - Directory basename under the source dir.
 * @returns Absolute path to the created skill directory.
 * @example await makeSourceSkill('theme-generator')
 */
async function makeSourceSkill(skillName: string): Promise<AbsolutePath> {
  const skillPath = join(sharedSourceDir, skillName)
  await mkdir(skillPath, { recursive: true })
  await writeFile(join(skillPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
  return skillPath
}

/**
 * Capture the reviewed identity the destructive IPC would have carried.
 * @param path - Path about to be deleted.
 * @returns Serializable identity for the reviewed directory.
 * @example await reviewedIdentityFor('/tmp/home/.agents/skills/theme-generator')
 */
async function reviewedIdentityFor(
  path: AbsolutePath,
): Promise<FilesystemEntryIdentity> {
  return filesystemIdentityFromStats(await lstat(path))
}

describe('moveToTrash durability across a kill', () => {
  beforeAll(async () => {
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedAgentCursor, { recursive: true })
  })

  afterAll(async () => {
    await rm(sharedHome, { recursive: true, force: true })
  })

  afterEach(async () => {
    const { __clearEvictTimersForTests } = await trashServicePromise
    __clearEvictTimersForTests()
    fsHooks.onManifestWrite = null
    fsHooks.failManifestWrite = false
    fsHooks.failCopyToDestination = null
    fsHooks.failPublishRename = false
    await rm(sharedTrashDir, { recursive: true, force: true })
    await rm(sharedSourceDir, { recursive: true, force: true })
    await rm(sharedAgentCursor, { recursive: true, force: true })
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedAgentCursor, { recursive: true })
  })

  test('hides the half-built entry from every tombstone reader while the source is already inside it', async () => {
    // Arrange
    // This is the crash window: the source has left ~/.agents/skills and the
    // manifest is not written yet. If anything in the trash parses as a
    // tombstone at this instant, a kill here hands startupCleanup a manifestless
    // entry to sweep and the skill is gone for good.
    const { moveToTrash } = await trashServicePromise
    const skillName: SkillName = 'killed-mid-move'
    const sourcePath = await makeSourceSkill(skillName)
    await symlink(sourcePath, join(sharedAgentCursor, skillName))
    const reviewedIdentity = await reviewedIdentityFor(sourcePath)

    let namesInTrashDuringBuild: string[] = []
    let skillFileWasAlreadyInTrash = false
    fsHooks.onManifestWrite = async () => {
      namesInTrashDuringBuild = await readdir(sharedTrashDir)
      skillFileWasAlreadyInTrash = namesInTrashDuringBuild.some((entryName) =>
        existsSync(join(sharedTrashDir, entryName, 'source', 'SKILL.md')),
      )
    }

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath,
      reviewedIdentity,
    )

    // Assert
    expect(
      namesInTrashDuringBuild.filter(
        (entryName) => tombstoneIdSchema.safeParse(entryName).success,
      ),
    ).toEqual([])
    // Guards against a vacuous pass: the window is only interesting once the
    // user's data is actually in there.
    expect(skillFileWasAlreadyInTrash).toBe(true)
    expect(result.kind).toBe('tombstoned')
    expect(await readdir(sharedTrashDir)).toEqual([
      result.kind === 'tombstoned' ? result.tombstoneId : '',
    ])
  })

  test('leaves a half-built entry on disk at startup instead of sweeping the only copy of the skill', async () => {
    // Arrange
    // Exactly what a kill in the window above leaves behind. Nothing may ever
    // sweep it: the folder inside is the user's only copy of that skill.
    const { startupCleanup } = await trashServicePromise
    const stagedEntryDir = join(
      sharedTrashDir,
      '.staging-1700000000000-killed-skill-aaaaaaaa',
    )
    const strandedSkillFile = join(stagedEntryDir, 'source', 'SKILL.md')
    await mkdir(join(stagedEntryDir, 'source'), { recursive: true })
    await writeFile(strandedSkillFile, '# killed-skill\n', 'utf-8')

    // Act
    await startupCleanup()

    // Assert
    expect(existsSync(strandedSkillFile)).toBe(true)
  })

  test('publishes a stranded entry under its tombstone name so manual recovery can still find it', async () => {
    // Arrange
    // Manifest write fails, and putting the source back fails too, so the copy
    // in the trash is all that is left. It has to end up under a name the
    // marker readers scan, not under the staged name they ignore.
    const { moveToTrash, TrashError } = await trashServicePromise
    const skillName: SkillName = 'stranded-skill'
    const sourcePath = await makeSourceSkill(skillName)
    const reviewedIdentity = await reviewedIdentityFor(sourcePath)
    fsHooks.onManifestWrite = async () => {}
    fsHooks.failManifestWrite = true
    fsHooks.failCopyToDestination = sourcePath

    // Act
    const moveError = await moveToTrash(
      skillName,
      sourcePath,
      reviewedIdentity,
    ).catch((error: unknown) => error)

    // Assert
    expect(moveError).toBeInstanceOf(TrashError)
    const publishedEntryNames = await readdir(sharedTrashDir)
    expect(
      publishedEntryNames.filter(
        (entryName) => tombstoneIdSchema.safeParse(entryName).success,
      ),
    ).toHaveLength(1)
    const publishedEntryDir = join(sharedTrashDir, publishedEntryNames[0])
    expect(existsSync(join(publishedEntryDir, 'source', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(publishedEntryDir, '.manual-recovery'))).toBe(true)
    expect(moveError).toMatchObject({
      message: expect.stringContaining(
        `source is stranded in ${join(publishedEntryDir, 'source')}`,
      ),
    })
  })

  test('still points the user at the stranded copy when even publishing it fails', async () => {
    // Arrange
    // Last resort: the source could not go back and the entry could not be
    // published either. The copy is still on disk under the staged name, which
    // nothing sweeps — so the error has to name that path rather than a
    // tombstone path that was never created.
    const { moveToTrash } = await trashServicePromise
    const skillName: SkillName = 'unpublishable-skill'
    const sourcePath = await makeSourceSkill(skillName)
    const reviewedIdentity = await reviewedIdentityFor(sourcePath)
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    fsHooks.onManifestWrite = async () => {}
    fsHooks.failManifestWrite = true
    fsHooks.failCopyToDestination = sourcePath
    fsHooks.failPublishRename = true

    // Act
    const moveError = await moveToTrash(
      skillName,
      sourcePath,
      reviewedIdentity,
    ).catch((error: unknown) => error)
    consoleErrorSpy.mockRestore()

    // Assert
    const stagedEntryNames = await readdir(sharedTrashDir)
    expect(stagedEntryNames).toHaveLength(1)
    const stagedEntryDir = join(sharedTrashDir, stagedEntryNames[0])
    expect(existsSync(join(stagedEntryDir, 'source', 'SKILL.md'))).toBe(true)
    expect(moveError).toMatchObject({
      message: expect.stringContaining(
        `source is stranded in ${join(stagedEntryDir, 'source')}`,
      ),
    })
  })
})
