import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  AbsolutePath,
  CliCommandOperationResult,
  CliCommandStatus,
} from '@/shared/types'

import { errorCode } from '../utils/errorCode'
import { extractErrorMessage } from '../utils/errors'

const CLI_COMMAND_NAME = 'skills-desktop'
const APP_BUNDLE_ID = 'io.laststance.skills-desktop'
const MANAGED_SHIM_START = '# >>> Skills Desktop CLI shim >>>'
const MANAGED_SHIM_END = '# <<< Skills Desktop CLI shim <<<'
const EXECUTABLE_FILE_MODE = 0o755

const CLI_COMMAND_DIR = join(homedir(), '.local', 'bin')
const CLI_COMMAND_PATH: AbsolutePath = join(CLI_COMMAND_DIR, CLI_COMMAND_NAME)

const SHIM_CONTENT = `#!/bin/sh
${MANAGED_SHIM_START}
# This file is managed by Skills Desktop from Settings.
exec open -b "${APP_BUNDLE_ID}"
${MANAGED_SHIM_END}
`

/**
 * Checks whether a file is the exact app-managed CLI shim that Settings may safely remove.
 * @param contents - Text read from the candidate command path.
 * @returns True only when the file exactly matches the generated app shim.
 * @example isManagedShim('# >>> Skills Desktop CLI shim >>>\nexec open -b "io.laststance.skills-desktop"\n# <<< Skills Desktop CLI shim <<<') // => true
 */
function isManagedShim(contents: string): boolean {
  return contents === SHIM_CONTENT
}

/**
 * Builds the shared status payload so IPC, tests, and Settings copy stay aligned.
 * @param status - Current command installation discriminator.
 * @param message - User-safe status explanation.
 * @returns Full command status payload with path/name attached.
 * @example buildStatus('not-installed', 'Command is not installed.')
 */
function buildStatus(
  status: CliCommandStatus['status'],
  message: string,
): CliCommandStatus {
  return {
    status,
    commandName: CLI_COMMAND_NAME,
    commandPath: CLI_COMMAND_PATH,
    message,
  }
}

/**
 * Reads ~/.local/bin/skills-desktop and classifies whether Settings can manage it.
 * @returns Installed/missing/blocked status for the app-level command shim.
 * @example await getCliCommandStatus()
 */
export async function getCliCommandStatus(): Promise<CliCommandStatus> {
  try {
    const entry = await fs.lstat(CLI_COMMAND_PATH)

    // Symlinks may point anywhere, so never follow or manage them from Settings.
    if (entry.isSymbolicLink()) {
      return buildStatus(
        'blocked',
        `${CLI_COMMAND_PATH} is already occupied by an unmanaged symlink.`,
      )
    }

    if (!entry.isFile()) {
      return buildStatus(
        'blocked',
        `${CLI_COMMAND_PATH} is already occupied by another filesystem entry.`,
      )
    }

    const contents = await fs.readFile(CLI_COMMAND_PATH, 'utf-8')
    if (isManagedShim(contents)) {
      return buildStatus('installed', 'Command is installed.')
    }

    return buildStatus(
      'blocked',
      `${CLI_COMMAND_PATH} is already occupied by an unmanaged file.`,
    )
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return buildStatus('not-installed', 'Command is not installed.')
    }

    return buildStatus(
      'blocked',
      `Could not inspect ${CLI_COMMAND_PATH}: ${extractErrorMessage(error)}`,
    )
  }
}

/**
 * Installs the managed `skills-desktop` shim unless another command already owns the path.
 * @returns Operation result with fresh status after the install attempt.
 * @example await installCliCommand()
 */
export async function installCliCommand(): Promise<CliCommandOperationResult> {
  const before = await getCliCommandStatus()
  if (before.status === 'installed') {
    return {
      ok: true,
      status: before,
      message: 'Command is already installed.',
    }
  }

  if (before.status === 'blocked') {
    return {
      ok: false,
      status: before,
      message: before.message,
    }
  }

  await fs.mkdir(CLI_COMMAND_DIR, { recursive: true })
  const temporaryPath = join(
    CLI_COMMAND_DIR,
    `.${CLI_COMMAND_NAME}.${randomUUID()}.tmp`,
  )

  try {
    await fs.writeFile(temporaryPath, SHIM_CONTENT, {
      encoding: 'utf-8',
      mode: EXECUTABLE_FILE_MODE,
      flag: 'wx',
    })
    await fs.chmod(temporaryPath, EXECUTABLE_FILE_MODE)
    // Publish with link() instead of rename(): link fails when the final
    // command path appears between status check and install, so we never
    // overwrite an unmanaged command in a race.
    await fs.link(temporaryPath, CLI_COMMAND_PATH)
    await fs.rm(temporaryPath, { force: true })
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    const status = await getCliCommandStatus()
    return {
      ok: false,
      status,
      message: `Could not install command: ${extractErrorMessage(error)}`,
    }
  }

  const status = await getCliCommandStatus()
  return {
    ok: status.status === 'installed',
    status,
    /* v8 ignore next 4 -- false arm of the message ternary is a TOCTOU race: it fires only if the shim is removed between the successful link() and the follow-up status check; normal app flow always reports installed here */
    message:
      status.status === 'installed'
        ? `Command installed at ${CLI_COMMAND_PATH}.`
        : status.message,
  }
}

/**
 * Removes only the managed `skills-desktop` shim and leaves unknown command paths untouched.
 * @returns Operation result with fresh status after the remove attempt.
 * @example await removeCliCommand()
 */
export async function removeCliCommand(): Promise<CliCommandOperationResult> {
  const before = await getCliCommandStatus()
  if (before.status === 'not-installed') {
    return {
      ok: true,
      status: before,
      message: 'Command is already removed.',
    }
  }

  if (before.status === 'blocked') {
    return {
      ok: false,
      status: before,
      message: before.message,
    }
  }

  try {
    await fs.unlink(CLI_COMMAND_PATH)
  } catch (error) {
    const status = await getCliCommandStatus()
    return {
      ok: false,
      status,
      message: `Could not remove command: ${extractErrorMessage(error)}`,
    }
  }

  const status = await getCliCommandStatus()
  return {
    ok: status.status === 'not-installed',
    status,
    /* v8 ignore next 2 -- false arm of the message ternary is a TOCTOU race: it fires only if the shim reappears between the successful unlink() and the follow-up status check; normal app flow always reports not-installed here */
    message:
      status.status === 'not-installed' ? 'Command removed.' : status.message,
  }
}
