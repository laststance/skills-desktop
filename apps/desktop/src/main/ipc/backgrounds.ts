import { BrowserWindow, dialog } from 'electron'

import {
  BackgroundImageError,
  discardBackgroundDraft,
  discardBackgroundDraftsForOwner,
  getBackgroundCatalog,
  importBackgroundImage,
} from '@/main/services/backgroundImages'
import {
  applyBackground,
  clearBackground,
  getBackgroundSnapshot,
  previewBackground,
  removeUploadedBackground,
  retryBackgroundDisplay,
  setBackgroundLayout,
} from '@/main/services/backgrounds'
import { BackgroundRemoteError } from '@/main/services/backgroundsRemote'
import { getSettings } from '@/main/services/settings'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'

/** Keeps ordinary background IPC failures readable without leaking native picker paths or filesystem internals.
 * @returns This action's result or a safe recoverable message for the existing Settings toaster.
 * @example await backgroundAction(() => previewBackground(source))
 */
async function backgroundAction<Result>(
  action: () => Promise<Result>,
): Promise<Result> {
  try {
    return await action()
  } catch (error) {
    throw safeBackgroundError(error)
  }
}

/** Keeps async gallery failures and synchronous Apply rejection on the same safe IPC boundary.
 * @returns Readable known errors or fixed recovery guidance after a private Main diagnostic.
 * @example throw safeBackgroundError(error)
 */
function safeBackgroundError(error: unknown): Error {
  if (
    error instanceof BackgroundImageError ||
    error instanceof BackgroundRemoteError
  )
    return new Error(error.message)
  // Keep diagnostics in Main; source paths and raw provider details never reach renderer messages.
  console.error(
    '[backgrounds] unexpected IPC failure',
    error instanceof Error ? error.name : 'Unknown error',
  )
  return new Error(
    'The background could not be updated. Check available disk space and permissions, then try again.',
  )
}

/** Registers the path-free gallery API; ownership transfers inside synchronous Apply before an IPC reply can be delayed.
 * @returns Nothing; native-picker imports are cleaned on owner destruction unless Main already accepted them.
 * @example registerBackgroundHandlers() // Called once with the other typed IPC handlers.
 */
export function registerBackgroundHandlers(): void {
  const watchedOwners = new WeakSet<Electron.WebContents>()
  typedHandle(IPC_CHANNELS.BACKGROUNDS_LIST, async () =>
    backgroundAction(async () =>
      getBackgroundCatalog(getSettings().background.uploads),
    ),
  )
  typedHandle(IPC_CHANNELS.BACKGROUNDS_IMPORT_IMAGE, async (event) =>
    backgroundAction(async () => {
      const owner = event.sender
      const ownerId = owner.id
      const window = BrowserWindow.fromWebContents(owner)
      if (!window || owner.isDestroyed()) return null
      // Install cleanup before opening the picker; closing during import also cancels pending staged inputs.
      if (!watchedOwners.has(owner)) {
        watchedOwners.add(owner)
        owner.once('destroyed', () => {
          void discardBackgroundDraftsForOwner(ownerId).catch(() =>
            console.warn('[backgrounds] closed-window draft cleanup failed'),
          )
        })
      }
      const selected = await dialog.showOpenDialog(window, {
        title: 'Choose a background image',
        properties: ['openFile'],
        filters: [
          { name: 'Static images', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
        ],
      })
      const path = selected.filePaths[0]
      if (selected.canceled || !path || owner.isDestroyed()) return null
      return importBackgroundImage(path, ownerId)
    }),
  )
  typedHandle(
    IPC_CHANNELS.BACKGROUNDS_DISCARD_DRAFT,
    async (_event, { draftId }) =>
      backgroundAction(async () => discardBackgroundDraft(draftId)),
  )
  typedHandle(IPC_CHANNELS.BACKGROUNDS_PREVIEW, async (_event, source) =>
    backgroundAction(async () => previewBackground(source)),
  )
  // Deliberately no async wrapper here: claim occurs before the accepted ID is returned to IPC.
  typedHandle(IPC_CHANNELS.BACKGROUNDS_APPLY, (_event, input) => {
    try {
      return applyBackground(input)
    } catch (error) {
      throw safeBackgroundError(error)
    }
  })
  typedHandle(IPC_CHANNELS.BACKGROUNDS_CLEAR, async () =>
    backgroundAction(clearBackground),
  )
  typedHandle(
    IPC_CHANNELS.BACKGROUNDS_REMOVE_UPLOAD,
    async (_event, { uploadId }) =>
      backgroundAction(async () => removeUploadedBackground(uploadId)),
  )
  typedHandle(IPC_CHANNELS.BACKGROUNDS_SET_LAYOUT, async (_event, layout) =>
    backgroundAction(async () => setBackgroundLayout(layout)),
  )
  typedHandle(IPC_CHANNELS.BACKGROUNDS_GET_SNAPSHOT, getBackgroundSnapshot)
  typedHandle(IPC_CHANNELS.BACKGROUNDS_RETRY_DISPLAY, async () =>
    backgroundAction(retryBackgroundDisplay),
  )
}
