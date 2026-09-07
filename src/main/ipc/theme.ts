import { broadcastTypedEvent } from '@/main/ipc/typedSend'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'

/**
 * Wires the cross-window theme relay:
 *  - `theme:broadcast`  re-emits a renderer's resolved theme as
 *                       `theme:changed` to every open window.
 *
 * Unlike settings, main is a pure relay here rather than the source of truth:
 * theme lives in renderer Redux and is persisted to localStorage, so there is
 * no main-process copy to update. The relay exists because each BrowserWindow
 * is its own renderer process with its own store, and the Settings window
 * would otherwise keep the palette it read at boot.
 *
 * The sender is deliberately left in the fan-out. The receiving listener
 * dispatches `syncTheme`, which the broadcasting listener does not match, so
 * the echo dies in one hop — cheaper than re-implementing
 * {@link broadcastTypedEvent}'s destroyed-window guard just to skip one window.
 *
 * The payload is validated against `IPC_ARG_SCHEMAS['theme:broadcast']` inside
 * {@link typedHandle} before it is fanned out.
 */
export function registerThemeHandlers(): void {
  typedHandle(IPC_CHANNELS.THEME_BROADCAST, (_event, theme) => {
    broadcastTypedEvent(IPC_CHANNELS.THEME_CHANGED, theme)
  })
}
