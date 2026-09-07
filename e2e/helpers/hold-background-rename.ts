import type { ElectronApplication } from '@playwright/test'

/** Holds one real isolated image/settings publication so lifecycle tests control the commit boundary.
 * @param electronApp - Test-owned Electron application.
 * @param target - Exact settings path or dedicated display directory inside this test's userData.
 * @param kind - Match one file or a direct child of the display directory.
 * @returns A Main-process handle that reports, releases and restores the actual filesystem boundary.
 * @example const held = await holdBackgroundRename(app, '/tmp/profile/backgrounds/displays', 'directory')
 */
export async function holdBackgroundRename(
  electronApp: ElectronApplication,
  target: string,
  kind: 'file' | 'directory',
) {
  return electronApp.evaluateHandle(
    (_electron, input) => {
      const fileSystem = process.getBuiltinModule('fs').promises
      const path = process.getBuiltinModule('path')
      const originalRename = fileSystem.rename
      let hasHeld = false
      let hasCompleted = false
      let release: (() => void) | undefined
      fileSystem.rename = async (...args) => {
        const destination = String(args[1])
        const matches =
          input.kind === 'file'
            ? destination === input.target
            : path.dirname(destination) === input.target
        // Hold exactly one owned publication; every unrelated rename keeps the original behavior.
        const shouldHold = !hasHeld && matches
        if (shouldHold) {
          hasHeld = true
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        await originalRename(...args)
        if (shouldHold) hasCompleted = true
      }
      return {
        isHeld: () => hasHeld,
        hasCompleted: () => hasCompleted,
        release: () => {
          release?.()
          release = undefined
        },
        restore: () => {
          fileSystem.rename = originalRename
          release?.()
        },
      }
    },
    { target, kind },
  )
}
