import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { lstat, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import { tombstoneIdSchema } from '@/main/ipc/ipc-schemas'
import type {
  AbsolutePath,
  FilesystemEntryIdentity,
  SkillName,
} from '@/shared/types'
import { toAbsolutePath, toSkillName } from '@/shared/types'

import { filesystemIdentityFromStats } from './filesystemIdentity'

// Same module-load stamping + realpath canonicalization as
// `trashService.integration.test.ts`: the mock factory has to capture a defined
// home before `trashService`'s top-level `TRASH_DIR` is computed, and
// `validatePath` resolves through `realpathSync`, so an uncanonicalized
// `/var/folders/...` would read as an escape from its own declared base.
const sharedHome = realpathSync(
  mkdtempSync(join(tmpdir(), 'skills-trash-dur-')),
)
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
  /** Decides which `fs.cp` destinations must fail, to strand the source. */
  failCopyWhen: null as null | ((destination: string) => boolean),
  /** Rejects the publish rename when set, to drive its fallback arm. */
  failPublishRename: false,
  /** Forces the source move into the trash to report a cross-device rename. */
  failCrossDeviceMove: false,
  /** Absolute entry directory whose `fs.readdir` must fail, to blind the sweep. */
  failReaddirFor: null as null | string,
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
    if (fsHooks.failCopyWhen?.(String(destination)) === true) {
      throw Object.assign(new Error('copy refused'), { code: 'EACCES' })
    }
    return actual.cp(source, destination, ...rest)
  }
  // Single-arg on purpose: `trashService` only ever lists TRASH_DIR and one
  // entry directory, both without options, so the overload set adds nothing.
  const readdirSpy = async (
    path: Parameters<typeof actual.readdir>[0],
  ): Promise<string[]> => {
    if (String(path) === fsHooks.failReaddirFor) {
      throw Object.assign(new Error('listing refused'), { code: 'EACCES' })
    }
    return actual.readdir(path)
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
    // Only the move into the trash goes cross-device; the sibling stage rename
    // stays in the source dir, which is what the EXDEV fallback relies on.
    if (
      fsHooks.failCrossDeviceMove &&
      String(destination).startsWith(sharedTrashDir)
    ) {
      throw Object.assign(new Error('cross-device move refused'), {
        code: 'EXDEV',
      })
    }
    return actual.rename(source, destination)
  }
  return {
    ...actual,
    default: actual,
    writeFile: writeFileSpy,
    cp: copySpy,
    readdir: readdirSpy,
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
  return toAbsolutePath(skillPath)
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
    fsHooks.failCopyWhen = null
    fsHooks.failPublishRename = false
    fsHooks.failCrossDeviceMove = false
    fsHooks.failReaddirFor = null
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
    const skillName: SkillName = toSkillName('killed-mid-move')
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
    const result = await moveToTrash(skillName, sourcePath, reviewedIdentity)

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
    const skillName: SkillName = toSkillName('stranded-skill')
    const sourcePath = await makeSourceSkill(skillName)
    const reviewedIdentity = await reviewedIdentityFor(sourcePath)
    fsHooks.onManifestWrite = async () => {}
    fsHooks.failManifestWrite = true
    fsHooks.failCopyWhen = (destination) => destination === sourcePath

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

  test('names the folder beside the original path when nothing ever reached the trash entry', async () => {
    // Arrange
    // Cross-device delete whose copy into the entry fails and whose restore
    // fails too. The reviewed folder is parked next to where it used to live,
    // and the trash entry holds nothing — so pointing the user at the entry
    // would send them to an empty path during a data-loss incident.
    const { moveToTrash } = await trashServicePromise
    const skillName: SkillName = toSkillName('stranded-beside-original')
    const sourcePath = await makeSourceSkill(skillName)
    const reviewedIdentity = await reviewedIdentityFor(sourcePath)
    fsHooks.failCrossDeviceMove = true
    fsHooks.failCopyWhen = (destination) =>
      destination === sourcePath || destination.endsWith('/source')

    // Act
    const moveError = await moveToTrash(
      skillName,
      sourcePath,
      reviewedIdentity,
    ).catch((error: unknown) => error)

    // Assert
    expect(existsSync(sourcePath)).toBe(false)
    const siblingStageNames = (await readdir(sharedSourceDir)).filter((name) =>
      name.startsWith(`.${skillName}.trash-source-`),
    )
    expect(siblingStageNames).toHaveLength(1)
    const siblingStageDir = join(sharedSourceDir, siblingStageNames[0])
    expect(existsSync(join(siblingStageDir, 'SKILL.md'))).toBe(true)
    // Nothing publishable was built, so the staged entry is dropped rather
    // than left behind as an empty tombstone the sweep must then protect.
    expect(await readdir(sharedTrashDir)).toEqual([])
    expect(moveError).toMatchObject({
      message: expect.stringContaining(
        `source preserved in ${siblingStageDir}`,
      ),
    })
  })

  test('keeps a published entry whose manifest did not survive the crash, because its source is the only copy', async () => {
    // Arrange
    // The publish rename is atomic, but the manifest bytes it publishes are
    // not: a power cut can land the directory entry and lose the file
    // contents. `restore` cannot read this entry, so sweeping it would be a
    // permanent delete rather than an expiry.
    const { startupCleanup } = await trashServicePromise
    const entryDir = join(
      sharedTrashDir,
      '1700000000000-torn-manifest-aaaaaaaa',
    )
    const strandedSkillFile = join(entryDir, 'source', 'SKILL.md')
    await mkdir(join(entryDir, 'source'), { recursive: true })
    await writeFile(strandedSkillFile, '# torn-manifest\n', 'utf-8')
    await writeFile(
      join(entryDir, 'manifest.json'),
      '{"schemaVersion":2,"kind":"source-',
      'utf-8',
    )

    // Act
    await startupCleanup()

    // Assert
    expect(existsSync(strandedSkillFile)).toBe(true)
  })

  test('keeps an entry it cannot even list, because a failed check is not proof the entry is empty', async () => {
    // Arrange
    // No manifest and no listing. Guessing "empty" here costs the user their
    // skill; guessing "occupied" costs a stray directory under ~/.agents.
    const { startupCleanup } = await trashServicePromise
    const entryDir = join(sharedTrashDir, '1700000000000-unlistable-bbbbbbbb')
    await mkdir(entryDir, { recursive: true })
    fsHooks.failReaddirFor = entryDir

    // Act
    await startupCleanup()

    // Assert
    expect(existsSync(entryDir)).toBe(true)
  })

  test('still points the user at the stranded copy when even publishing it fails', async () => {
    // Arrange
    // Last resort: the source could not go back and the entry could not be
    // published either. The copy is still on disk under the staged name, which
    // nothing sweeps — so the error has to name that path rather than a
    // tombstone path that was never created.
    const { moveToTrash } = await trashServicePromise
    const skillName: SkillName = toSkillName('unpublishable-skill')
    const sourcePath = await makeSourceSkill(skillName)
    const reviewedIdentity = await reviewedIdentityFor(sourcePath)
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    fsHooks.onManifestWrite = async () => {}
    fsHooks.failManifestWrite = true
    fsHooks.failCopyWhen = (destination) => destination === sourcePath
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
