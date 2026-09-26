import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import {
  BackgroundApplyInputSchema,
  type BackgroundSnapshot,
} from '@/shared/backgrounds'
import type { BackgroundsApi } from '@/shared/ipc-contract'
import { DEFAULT_SETTINGS } from '@/shared/settings'

const electronMock = vi.hoisted(() => ({
  exposeInMainWorld:
    vi.fn<(name: string, api: { backgrounds: BackgroundsApi }) => void>(),
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
  on: vi.fn<
    (
      channel: string,
      listener: (event: unknown, payload: BackgroundSnapshot) => void,
    ) => void
  >(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMock.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener,
  },
}))

let exposedBackgrounds: BackgroundsApi | undefined

/** Tests inspect the actual exposed preload object so a missing bridge method breaks the contract check.
 * @returns The background bridge exposed by the real preload module.
 * @example getBackgroundsApi().getSnapshot() // Uses backgrounds:getSnapshot IPC.
 */
function getBackgroundsApi(): BackgroundsApi {
  if (!exposedBackgrounds)
    throw new Error('Electron preload bridge was not exposed')
  return exposedBackgrounds
}

describe('background preload bridge', () => {
  beforeAll(async () => {
    vi.stubGlobal('__E2E_BUILD__', false)
    await import('./index')
    // Vitest clears call history between tests; retain the real exposed object, not mock history.
    exposedBackgrounds = electronMock.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'electron',
    )?.[1].backgrounds
  })

  beforeEach(() => {
    electronMock.invoke.mockReset()
    electronMock.on.mockClear()
    electronMock.removeListener.mockClear()
  })

  afterAll(() => vi.unstubAllGlobals())

  test.each([
    { kind: 'upload-draft', draftId: 'bff22dd2-3507-4e22-b580-28f4d97d8216' },
    { kind: 'upload', uploadId: 'bff22dd2-3507-4e22-b580-28f4d97d8216' },
  ])(
    'preserves the ownership distinction when accepting %j',
    async (source) => {
      // Arrange
      const input = BackgroundApplyInputSchema.parse({
        requestId: 'f627d32a-3641-4d52-9814-22e4d6e2f2fb',
        source,
        crop: { x: 0, y: 0, width: 100, height: 100 },
        aspect: 'original',
      })
      electronMock.invoke.mockResolvedValue({
        operationId: 7,
        requestId: input.requestId,
      })
      // Act
      const accepted = await getBackgroundsApi().apply(input)
      // Assert
      expect(electronMock.invoke).toHaveBeenCalledExactlyOnceWith(
        'backgrounds:apply',
        input,
      )
      expect(accepted).toEqual({
        operationId: 7,
        requestId: 'f627d32a-3641-4d52-9814-22e4d6e2f2fb',
      })
    },
  )

  test('keeps picker cancellation distinct from an imported draft', async () => {
    // Arrange
    electronMock.invoke.mockResolvedValue(null)
    // Act
    const draft = await getBackgroundsApi().importImage()
    // Assert
    expect(draft).toBeNull()
    expect(electronMock.invoke).toHaveBeenCalledExactlyOnceWith(
      'backgrounds:importImage',
    )
  })

  test('forwards only an opaque token when discarding an unaccepted upload', async () => {
    // Arrange
    electronMock.invoke.mockResolvedValue(undefined)
    // Act
    await getBackgroundsApi().discardDraft({
      draftId: 'bff22dd2-3507-4e22-b580-28f4d97d8216',
    })
    // Assert
    expect(electronMock.invoke).toHaveBeenCalledExactlyOnceWith(
      'backgrounds:discardDraft',
      { draftId: 'bff22dd2-3507-4e22-b580-28f4d97d8216' },
    )
  })

  test('returns the canonical settings from layout and library operations', async () => {
    // Arrange
    electronMock.invoke.mockResolvedValue(DEFAULT_SETTINGS)
    const api = getBackgroundsApi()
    // Act
    const layoutSettings = await api.setLayout('fit')
    const removalSettings = await api.removeUpload({
      uploadId: 'bff22dd2-3507-4e22-b580-28f4d97d8216',
    })
    const clearedSettings = await api.clear()
    // Assert
    expect(layoutSettings).toEqual(DEFAULT_SETTINGS)
    expect(removalSettings).toEqual(DEFAULT_SETTINGS)
    expect(clearedSettings).toEqual(DEFAULT_SETTINGS)
    expect(electronMock.invoke.mock.calls).toEqual([
      ['backgrounds:setLayout', 'fit'],
      [
        'backgrounds:removeUpload',
        { uploadId: 'bff22dd2-3507-4e22-b580-28f4d97d8216' },
      ],
      ['backgrounds:clear'],
    ])
  })

  test('keeps bounded previews and catalog reads behind Main IPC', async () => {
    // Arrange
    const api = getBackgroundsApi()
    electronMock.invoke.mockResolvedValue({ builtins: [], uploads: [] })
    // Act
    const catalog = await api.list()
    await api.preview({ kind: 'builtin', builtinId: 'alpine-lake' })
    // Assert
    expect(catalog).toEqual({ builtins: [], uploads: [] })
    expect(electronMock.invoke.mock.calls).toEqual([
      ['backgrounds:list'],
      ['backgrounds:preview', { kind: 'builtin', builtinId: 'alpine-lake' }],
    ])
  })

  test('asks Main to retry the current display and preserves its explicit retry revision', async () => {
    // Arrange
    const snapshot: BackgroundSnapshot = {
      revision: 5,
      displayRetryRevision: 1,
      operation: null,
      display: null,
    }
    electronMock.invoke.mockResolvedValue(snapshot)
    // Act
    const retriedSnapshot = await getBackgroundsApi().retryDisplay()
    // Assert
    expect(electronMock.invoke).toHaveBeenCalledExactlyOnceWith(
      'backgrounds:retryDisplay',
    )
    expect(retriedSnapshot).toEqual({
      revision: 5,
      displayRetryRevision: 1,
      operation: null,
      display: null,
    })
  })

  test('subscribes before snapshot retrieval and removes the exact listener on closure', async () => {
    // Arrange
    const api = getBackgroundsApi()
    const receiveSnapshot = vi.fn()
    const snapshot: BackgroundSnapshot = {
      revision: 4,
      displayRetryRevision: 0,
      operation: null,
      display: null,
    }
    electronMock.invoke.mockResolvedValue(snapshot)
    // Act
    const unsubscribe = api.onChanged(receiveSnapshot)
    const restoredSnapshot = await api.getSnapshot()
    const listener = electronMock.on.mock.calls[0]?.[1]
    listener?.({}, snapshot)
    unsubscribe()
    // Assert
    expect(restoredSnapshot).toEqual({
      revision: 4,
      displayRetryRevision: 0,
      operation: null,
      display: null,
    })
    expect(electronMock.invoke).toHaveBeenCalledExactlyOnceWith(
      'backgrounds:getSnapshot',
    )
    expect(electronMock.on.mock.calls[0]?.[0]).toBe('backgrounds:changed')
    expect(receiveSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot)
    expect(electronMock.removeListener).toHaveBeenCalledExactlyOnceWith(
      'backgrounds:changed',
      listener,
    )
  })
})
