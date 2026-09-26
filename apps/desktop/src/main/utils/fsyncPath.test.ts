import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * Arms the mocked `fs.open` per test. Hoisted so the `vi.mock` factory can
 * close over it; left null so every other test runs against the real handle.
 */
const openHooks = vi.hoisted(() => ({
  /** Replaces the opened handle, to observe `sync`/`close` or fail the flush. */
  handleOverride: null as null | {
    sync: () => Promise<void>
    close: () => Promise<void>
  },
  /** Every path handed to `fs.open`, so a real flush can be proven to happen. */
  openedPaths: [] as string[],
}))

vi.mock('node:fs/promises', async () => {
  const actual =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const openSpy: typeof actual.open = async (path, ...rest) => {
    openHooks.openedPaths.push(String(path))
    if (openHooks.handleOverride) {
      // The only cast in this file, and unavoidable: a stub standing in for a
      // FileHandle would otherwise have to implement every member of it, none
      // of which fsyncPath touches beyond sync and close.
      return openHooks.handleOverride as unknown as Awaited<
        ReturnType<typeof actual.open>
      >
    }
    return actual.open(path, ...rest)
  }
  return { ...actual, default: actual, open: openSpy }
})

const { fsyncPath } = await import('./fsyncPath')

describe('fsyncPath', () => {
  afterEach(() => {
    openHooks.handleOverride = null
    openHooks.openedPaths = []
    vi.restoreAllMocks()
  })

  test('flushes the file to stable storage instead of leaving it in the page cache', async () => {
    // Arrange
    const workDir = await mkdtemp(join(tmpdir(), 'fsync-file-'))
    const manifestPath = join(workDir, 'manifest.json')
    await writeFile(manifestPath, '{"schemaVersion":2}', 'utf-8')
    const syncSpy = vi.fn(async () => {})
    const closeSpy = vi.fn(async () => {})
    openHooks.handleOverride = { sync: syncSpy, close: closeSpy }

    // Act
    await fsyncPath(manifestPath)

    // Assert
    expect(syncSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    await rm(workDir, { recursive: true, force: true })
  })

  test('flushes a directory too, so a published rename survives a power cut', async () => {
    // Arrange
    const trashDir = await mkdtemp(join(tmpdir(), 'fsync-dir-'))
    await writeFile(join(trashDir, 'manifest.json'), '{}', 'utf-8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Act
    await fsyncPath(trashDir)

    // Assert
    // No override here on purpose: this is the one test that proves the real
    // platform accepts `open(dir, 'r')` + `sync()`, which is what lets one
    // helper cover both the manifest and the directory that names it.
    expect(openHooks.openedPaths).toEqual([trashDir])
    expect(warnSpy).not.toHaveBeenCalled()
    expect(await readFile(join(trashDir, 'manifest.json'), 'utf-8')).toBe('{}')
    await rm(trashDir, { recursive: true, force: true })
  })

  test('returns quietly when the path cannot be opened, so a failed flush never rolls back a delete that worked', async () => {
    // Arrange
    const workDir = await mkdtemp(join(tmpdir(), 'fsync-missing-'))
    const missingPath = join(workDir, 'never-created.json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Act
    const outcome = await fsyncPath(missingPath).then(
      () => 'resolved',
      () => 'rejected',
    )

    // Assert
    expect(outcome).toBe('resolved')
    expect(warnSpy).toHaveBeenCalledWith('fsyncPath: flush failed', {
      path: missingPath,
      code: 'ENOENT',
      message: expect.stringContaining('ENOENT'),
    })
    await rm(workDir, { recursive: true, force: true })
  })

  test('returns quietly when the flush itself is refused, not just the open', async () => {
    // Arrange
    const workDir = await mkdtemp(join(tmpdir(), 'fsync-refused-'))
    const manifestPath = join(workDir, 'manifest.json')
    await writeFile(manifestPath, '{}', 'utf-8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const closeSpy = vi.fn(async () => {})
    openHooks.handleOverride = {
      sync: async () => {
        throw Object.assign(new Error('flush refused'), { code: 'EIO' })
      },
      close: closeSpy,
    }

    // Act
    const outcome = await fsyncPath(manifestPath).then(
      () => 'resolved',
      () => 'rejected',
    )

    // Assert
    expect(outcome).toBe('resolved')
    expect(warnSpy).toHaveBeenCalledWith('fsyncPath: flush failed', {
      path: manifestPath,
      code: 'EIO',
      message: 'flush refused',
    })
    // Still closed: a handle leaked on the error path outlives the process.
    expect(closeSpy).toHaveBeenCalledTimes(1)
    await rm(workDir, { recursive: true, force: true })
  })

  test('still returns when the handle cannot even be closed, so a stuck fd cannot fail a delete', async () => {
    // Arrange
    const workDir = await mkdtemp(join(tmpdir(), 'fsync-unclosable-'))
    const manifestPath = join(workDir, 'manifest.json')
    await writeFile(manifestPath, '{}', 'utf-8')
    const syncSpy = vi.fn(async () => {})
    openHooks.handleOverride = {
      sync: syncSpy,
      close: async () => {
        throw Object.assign(new Error('close refused'), { code: 'EIO' })
      },
    }

    // Act
    const outcome = await fsyncPath(manifestPath).then(
      () => 'resolved',
      () => 'rejected',
    )

    // Assert
    expect(outcome).toBe('resolved')
    // The flush is what the caller depends on; it landed before the close failed.
    expect(syncSpy).toHaveBeenCalledTimes(1)
    await rm(workDir, { recursive: true, force: true })
  })
})
