import { useCallback } from 'react'
import { toast } from 'sonner'

import type { AbsolutePath } from '../../../shared/types'

/**
 * Renderer-side wrapper around `window.electron.folder.{revealInFinder,openInTerminal}`.
 *
 * Both methods return a `Promise<FolderActionResult>` that NEVER rejects —
 * the main process maps every failure (path missing, app not installed,
 * spawn error) into `{ ok: false, ... message }`. The hook surfaces that
 * `message` as a `toast.error` and otherwise stays out of the way.
 *
 * Deliberately no double-click / debounce guard: spamming "Reveal in Finder"
 * 5× just brings Finder forward 5×, which is harmless. Adding a guard would
 * cost UX clarity (greyed-out menu items mid-launch) for no real protection.
 *
 * Returned methods are wrapped in `useCallback` with empty deps so they are
 * referentially stable across re-renders — safe to pass to `<DropdownMenuItem>`
 * `onSelect` props that compare on identity.
 *
 * @returns
 * - `revealInFinder(folderPath)`: opens the folder in macOS Finder
 * - `openInTerminal(folderPath)`: opens the user's preferred terminal at `cwd = folderPath`
 * @example
 * const { revealInFinder, openInTerminal } = useOpenFolder()
 * <DropdownMenuItem onSelect={() => void revealInFinder(agent.path)}>
 *   Reveal in Finder
 * </DropdownMenuItem>
 */
export function useOpenFolder(): {
  revealInFinder: (folderPath: AbsolutePath) => Promise<void>
  openInTerminal: (folderPath: AbsolutePath) => Promise<void>
} {
  const revealInFinder = useCallback(
    async (folderPath: AbsolutePath): Promise<void> => {
      const result = await window.electron.folder.revealInFinder(folderPath)
      if (!result.ok) {
        toast.error(result.message)
      }
    },
    [],
  )

  const openInTerminal = useCallback(
    async (folderPath: AbsolutePath): Promise<void> => {
      const result = await window.electron.folder.openInTerminal(folderPath)
      if (!result.ok) {
        toast.error(result.message)
      }
    },
    [],
  )

  return { revealInFinder, openInTerminal }
}
