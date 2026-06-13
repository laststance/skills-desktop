import * as nodeFs from 'node:fs'
import { mkdtempSync, realpathSync } from 'node:fs'
import {
  lstat,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const sharedHome = realpathSync(
  mkdtempSync(join(tmpdir(), 'skills-cli-command-')),
)
const commandPath = join(sharedHome, '.local', 'bin', 'skills-desktop')

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return {
    ...actual,
    homedir: () => sharedHome,
  }
})

const servicePromise = (async () => import('./cliCommandService'))()

describe('cliCommandService', () => {
  afterEach(async () => {
    // Drop any per-test fs.promises spies so later tests hit the real filesystem.
    vi.restoreAllMocks()
    await rm(join(sharedHome, '.local'), { recursive: true, force: true })
  })

  afterAll(async () => {
    await rm(sharedHome, { recursive: true, force: true })
  })

  it('reports the command as not installed when ~/.local/bin/skills-desktop is missing', async () => {
    // Arrange
    const { getCliCommandStatus } = await servicePromise

    // Act
    const status = await getCliCommandStatus()

    // Assert
    expect(status).toEqual({
      status: 'not-installed',
      commandName: 'skills-desktop',
      commandPath,
      message: 'Command is not installed.',
    })
  })

  it('installs an executable shim that opens the Skills Desktop bundle', async () => {
    // Arrange
    const { installCliCommand } = await servicePromise

    // Act
    const result = await installCliCommand()

    // Assert
    expect(result.ok).toBe(true)
    expect(result.status.status).toBe('installed')
    expect(result.message).toBe(`Command installed at ${commandPath}.`)
    expect(await readFile(commandPath, 'utf-8')).toBe(`#!/bin/sh
# >>> Skills Desktop CLI shim >>>
# This file is managed by Skills Desktop from Settings.
exec open -b "io.laststance.skills-desktop"
# <<< Skills Desktop CLI shim <<<
`)
    expect((await stat(commandPath)).mode & 0o777).toBe(0o755)
  })

  it('refuses to overwrite an unmanaged file that already uses the command path', async () => {
    // Arrange
    const { installCliCommand } = await servicePromise
    await mkdir(join(sharedHome, '.local', 'bin'), { recursive: true })
    await writeFile(commandPath, '#!/bin/sh\necho unmanaged\n', 'utf-8')

    // Act
    const result = await installCliCommand()

    // Assert
    expect(result).toEqual({
      ok: false,
      status: {
        status: 'blocked',
        commandName: 'skills-desktop',
        commandPath,
        message: `${commandPath} is already occupied by an unmanaged file.`,
      },
      message: `${commandPath} is already occupied by an unmanaged file.`,
    })
    expect(await readFile(commandPath, 'utf-8')).toBe(
      '#!/bin/sh\necho unmanaged\n',
    )
  })

  it('refuses to remove a user-edited script that contains the managed markers', async () => {
    // Arrange
    const { removeCliCommand } = await servicePromise
    const editedScript = `#!/bin/sh
# >>> Skills Desktop CLI shim >>>
# This file is managed by Skills Desktop from Settings.
echo "custom logic"
exec open -b "io.laststance.skills-desktop"
# <<< Skills Desktop CLI shim <<<
`
    await mkdir(join(sharedHome, '.local', 'bin'), { recursive: true })
    await writeFile(commandPath, editedScript, 'utf-8')

    // Act
    const result = await removeCliCommand()

    // Assert
    expect(result).toEqual({
      ok: false,
      status: {
        status: 'blocked',
        commandName: 'skills-desktop',
        commandPath,
        message: `${commandPath} is already occupied by an unmanaged file.`,
      },
      message: `${commandPath} is already occupied by an unmanaged file.`,
    })
    expect(await readFile(commandPath, 'utf-8')).toBe(editedScript)
  })

  it('removes the managed shim and leaves the command path missing afterward', async () => {
    // Arrange
    const { installCliCommand, removeCliCommand } = await servicePromise
    await installCliCommand()

    // Act
    const result = await removeCliCommand()

    // Assert
    expect(result).toEqual({
      ok: true,
      status: {
        status: 'not-installed',
        commandName: 'skills-desktop',
        commandPath,
        message: 'Command is not installed.',
      },
      message: 'Command removed.',
    })
    await expect(lstat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to remove an unmanaged symlink that occupies the command path', async () => {
    // Arrange
    const { removeCliCommand } = await servicePromise
    await mkdir(join(sharedHome, '.local', 'bin'), { recursive: true })
    await symlink('/usr/bin/open', commandPath)

    // Act
    const result = await removeCliCommand()

    // Assert
    expect(result).toEqual({
      ok: false,
      status: {
        status: 'blocked',
        commandName: 'skills-desktop',
        commandPath,
        message: `${commandPath} is already occupied by an unmanaged symlink.`,
      },
      message: `${commandPath} is already occupied by an unmanaged symlink.`,
    })
    expect((await lstat(commandPath)).isSymbolicLink()).toBe(true)
  })

  it('blocks management when a directory squats on the command path', async () => {
    // Arrange
    const { getCliCommandStatus } = await servicePromise
    await mkdir(commandPath, { recursive: true })

    // Act
    const status = await getCliCommandStatus()

    // Assert
    expect(status).toEqual({
      status: 'blocked',
      commandName: 'skills-desktop',
      commandPath,
      message: `${commandPath} is already occupied by another filesystem entry.`,
    })
  })

  it('blocks management when the command path cannot be inspected', async () => {
    // Arrange
    const { getCliCommandStatus } = await servicePromise
    // Make ~/.local/bin a regular file so lstat-ing a child path throws ENOTDIR.
    await mkdir(join(sharedHome, '.local'), { recursive: true })
    await writeFile(
      join(sharedHome, '.local', 'bin'),
      'not a directory',
      'utf-8',
    )

    // Act
    const status = await getCliCommandStatus()

    // Assert
    expect(status.status).toBe('blocked')
    expect(status.commandName).toBe('skills-desktop')
    expect(status.commandPath).toBe(commandPath)
    expect(status.message).toContain(`Could not inspect ${commandPath}:`)
  })

  it('reports success without rewriting when the command is already installed', async () => {
    // Arrange
    const { installCliCommand } = await servicePromise
    await installCliCommand()

    // Act
    const result = await installCliCommand()

    // Assert
    expect(result).toEqual({
      ok: true,
      status: {
        status: 'installed',
        commandName: 'skills-desktop',
        commandPath,
        message: 'Command is installed.',
      },
      message: 'Command is already installed.',
    })
  })

  it('surfaces a failure message when writing the shim throws', async () => {
    // Arrange
    const { installCliCommand } = await servicePromise
    vi.spyOn(nodeFs.promises, 'writeFile').mockRejectedValueOnce(
      new Error('disk full'),
    )

    // Act
    const result = await installCliCommand()

    // Assert
    expect(result.ok).toBe(false)
    expect(result.status.status).toBe('not-installed')
    expect(result.message).toBe('Could not install command: disk full')
  })

  it('reports success when the command is already absent', async () => {
    // Arrange
    const { removeCliCommand } = await servicePromise

    // Act
    const result = await removeCliCommand()

    // Assert
    expect(result).toEqual({
      ok: true,
      status: {
        status: 'not-installed',
        commandName: 'skills-desktop',
        commandPath,
        message: 'Command is not installed.',
      },
      message: 'Command is already removed.',
    })
  })

  it('surfaces a failure message when deleting the managed shim throws', async () => {
    // Arrange
    const { installCliCommand, removeCliCommand } = await servicePromise
    await installCliCommand()
    vi.spyOn(nodeFs.promises, 'unlink').mockRejectedValueOnce(
      new Error('disk full'),
    )

    // Act
    const result = await removeCliCommand()

    // Assert
    expect(result.ok).toBe(false)
    expect(result.status.status).toBe('installed')
    expect(result.message).toBe('Could not remove command: disk full')
  })
})
