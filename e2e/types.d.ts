/**
 * Type augmentations for the renderer's `window` when the bundle was built
 * with `E2E_BUILD=1`. These let `page.evaluate(() => window.__store__)` etc.
 * type-check inside Playwright tests.
 */

interface RecordedIpcEvent {
  channel: string
  data: unknown
  timestamp: number
}

interface IpcEventsApi {
  list: () => RecordedIpcEvent[]
  clear: () => void
  count: (channel: string) => number
}

interface ExposedReduxStore {
  dispatch: (action: { type: string; payload?: unknown }) => unknown
  getState: () => unknown
  subscribe: (listener: () => void) => () => void
}

declare global {
  interface Window {
    __store?: ExposedReduxStore
    __store__?: ExposedReduxStore
    __ipcEvents__?: IpcEventsApi
  }
}

export {}
