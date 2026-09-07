import type { ElectronApplication } from '@playwright/test'

/** Holds the real Apply reply after Main accepts it, proving native window closure cannot revoke transferred input.
 * @param electronApp - Test-owned Electron application with production IPC already registered.
 * @returns A scoped handle that observes accepted replies, releases them and restores the original handler.
 * @example const reply = await holdBackgroundApplyReply(app) // Close Settings after reply.hasAccepted().
 */
export async function holdBackgroundApplyReply(
  electronApp: ElectronApplication,
) {
  return electronApp.evaluateHandle(({ ipcMain }) => {
    // Electron offers no public handler getter; the test wraps its live invoke registry without adding debug IPC.
    const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
    if (!(handlers instanceof Map))
      throw new Error(
        'Electron invoke registry is unavailable for the acknowledgement race test',
      )
    const originalHandler: unknown = handlers.get('backgrounds:apply')
    if (typeof originalHandler !== 'function')
      throw new Error('Production background Apply IPC is not registered')
    let hasAccepted = false
    let release: (() => void) | undefined
    const heldHandler = async (...args: unknown[]) => {
      const accepted: unknown = await originalHandler(...args)
      hasAccepted = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return accepted
    }
    handlers.set('backgrounds:apply', heldHandler)
    return {
      hasAccepted: () => hasAccepted,
      release: () => {
        release?.()
        release = undefined
      },
      restore: () => {
        if (handlers.get('backgrounds:apply') === heldHandler)
          handlers.set('backgrounds:apply', originalHandler)
        release?.()
      },
    }
  })
}
