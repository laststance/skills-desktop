import { join } from 'path'

import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  screen,
  session,
} from 'electron'

import { isAllowedSkillsUrl } from '@/shared/marketplaceUrlPolicy'

import { registerAllHandlers } from './ipc/handlers'
import { getMainWindow, setMainWindow } from './services/mainWindowState'
import { getSettings, loadSettings } from './services/settings'
import { createOrFocusSettingsWindow } from './services/settingsWindow'
import { startupCleanup as runTrashStartupCleanup } from './services/trashService'
import { initAutoUpdater } from './updater'
import { attachExternalLinkHandler } from './utils/attachExternalLinkHandler'
import { clampSizeToWorkArea } from './utils/clampSizeToWorkArea'
import { isE2EBackgroundLaunch } from './utils/e2eEnv'
import { getSecureWebPreferences } from './utils/secureWebPreferences'

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

/**
 * Default launch size used when the user has no persisted `windowSize`
 * preference. Mirrors the previous hard-coded constructor values; with no
 * preference the app maximizes on `ready-to-show` so users keep the original
 * "fills the screen" behavior on first launch.
 */
const DEFAULT_LAUNCH_WIDTH = 1200
const DEFAULT_LAUNCH_HEIGHT = 800

function createWindow(): void {
  // Resolve the launch size from settings. `undefined` means the user has
  // not chosen one — fall back to the default size + `maximize()` on
  // ready-to-show. When set, we clamp to the current display's work area
  // so a size saved on a wider monitor doesn't open off-screen on a smaller
  // one (clamping happens *before* the BrowserWindow is constructed because
  // Electron applies `width`/`height` literally — there's no built-in clamp).
  const persistedWindowSize = getSettings().windowSize
  const primaryWorkArea = screen.getPrimaryDisplay().workAreaSize
  const hasCustomSize = persistedWindowSize !== undefined
  const launchSize = hasCustomSize
    ? clampSizeToWorkArea(persistedWindowSize, primaryWorkArea)
    : { width: DEFAULT_LAUNCH_WIDTH, height: DEFAULT_LAUNCH_HEIGHT }

  const window = new BrowserWindow({
    // `useContentSize` makes `width`/`height` (and `minWidth`/`minHeight`)
    // describe the content area instead of the outer frame. Required for
    // exact round-trip with the persisted size: the renderer captures via
    // `window:getMainBounds` → `getContentBounds()`, so the stored value
    // is content-area dimensions. Without this flag, restoring would treat
    // those as outer-frame dimensions and shave off the titlebar (~28px
    // even with `hiddenInset`) on every save→restore cycle.
    useContentSize: true,
    width: launchSize.width,
    height: launchSize.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0A0F1C',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      ...getSecureWebPreferences(),
      // Main-window-only: <webview> is used by the marketplace tab to
      // embed skills.sh; Settings window doesn't need it.
      webviewTag: true,
    },
  })
  setMainWindow(window)

  window.on('closed', () => {
    setMainWindow(null)
  })

  window.on('ready-to-show', () => {
    // E2E: keep the window completely hidden. Skipping both maximize() and
    // show() prevents the OS from rendering the window at all — Playwright
    // still drives the renderer through webContents, which is loaded
    // independently of window visibility.
    if (isE2EBackgroundLaunch) return
    // When the user has chosen a custom size in Settings we honor it
    // verbatim — calling `maximize()` here would override their choice.
    // No-preference still maximizes (preserves prior launch behavior).
    if (!hasCustomSize) {
      window.maximize()
    }
    window.show()
  })

  /** Enforce safe webview options before attachment (Electron security recommendation).
   * Deny-by-default: only allow https://skills.sh origins.
   * @param event - Prevents webview attachment when URL is disallowed
   * @param webPreferences - Hardened to disable node integration
   * @param params - Contains the src URL to validate
   */
  window.webContents.on(
    'will-attach-webview',
    (event, webPreferences, params) => {
      if (!isAllowedSkillsUrl(params.src)) {
        event.preventDefault()
        return
      }

      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      delete webPreferences.preload
    },
  )

  attachExternalLinkHandler(window)

  // Enforce Content Security Policy in production builds.
  // Use file: and app: schemes explicitly since 'self' may not reliably match file:// origins.
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' file: app:; script-src 'self' file: app:; style-src 'self' 'unsafe-inline' file: app:; font-src 'self' data: file: app:; img-src 'self' data: file: app:; connect-src 'self'",
          ],
        },
      })
    })
  }

  // HMR for renderer based on electron-vite cli
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Configure the native macOS About panel shown via the app menu's
 * `role: 'about'` item (or `app.showAboutPanel()`).
 *
 * macOS render order: icon → applicationName → applicationVersion → credits → copyright.
 * The About panel always renders `NSApp.applicationIconImage`; `setAboutPanelOptions`
 * `iconPath` is ignored on macOS. We therefore override the Dock icon via
 * `app.dock.setIcon()` — which updates `applicationIconImage` and propagates to the
 * About panel. In packaged builds the `.icns` bundle already supplies the correct
 * icon, so this is primarily a dev-mode fix.
 *
 * The `credits` block mirrors VS Code's convention — listing runtime versions and a
 * repo link so users can copy the block into bug reports.
 * @example
 * configureAboutPanel() // Call once before createMenu() in app.whenReady()
 */
function configureAboutPanel(): void {
  const appVersion = app.getVersion()
  const electronVersion = process.versions.electron
  const chromiumVersion = process.versions.chrome
  const nodeVersion = process.versions.node
  const platformAndArch = `${process.platform}-${process.arch}`
  const currentYear = new Date().getFullYear()

  // Resolve the bundled app icon (works in both dev and packaged builds).
  // In dev: `__dirname` is `out/main/`, so `../../resources/icon.icns` walks up to the repo root.
  // In packaged: `resources/` is asarUnpacked per electron-builder.yml, and the same
  // relative walk lands in `<app>.app/Contents/Resources/app.asar.unpacked/resources/`.
  const iconPath = join(__dirname, '../../resources/icon.icns')
  const appIconImage = nativeImage.createFromPath(iconPath)
  const isAppIconAvailable = !appIconImage.isEmpty()

  // Force the About panel (and Dock) to use our bundled icon.
  // In dev, the Electron default icon ships otherwise; this pulls in the real brand.
  if (isAppIconAvailable && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconImage)
  }

  const creditsLines = [
    'Visualize installed Skills and symlink status across AI agents.',
    '',
    `Electron ${electronVersion}  ·  Chromium ${chromiumVersion}`,
    `Node.js ${nodeVersion}  ·  ${platformAndArch}`,
    '',
    'https://github.com/laststance/skills-desktop',
  ]

  app.setAboutPanelOptions({
    applicationName: 'Skills Desktop',
    applicationVersion: appVersion,
    copyright: `© ${currentYear} Laststance.io`,
    credits: creditsLines.join('\n'),
  })
}

// Minimal menu bar
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: (): void => {
            createOrFocusSettingsWindow()
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        // `toggleDevTools` carries the default Cmd+Opt+I accelerator and
        // dispatches to whichever window currently has focus — so the
        // shortcut works on both the main window and the Settings window
        // out of the box. Keep this entry available in packaged builds:
        // power users rely on the standard shortcut to inspect visual
        // glitches and capture detail for bug reports (issue #123).
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(async () => {
  // E2E: hide from Dock / Cmd-Tab BEFORE any other init runs. Done first
  // because `configureAboutPanel()` below calls `app.dock.setIcon()`,
  // which would briefly flash the Dock icon if the policy is still
  // `regular`. macOS-only API; guard with platform check to avoid
  // runtime errors on Linux/Windows CI runners.
  if (isE2EBackgroundLaunch && process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
  }

  // Register IPC handlers before creating window
  registerAllHandlers()

  // Hydrate settings cache before any window opens so the first
  // `settings:get` from the renderer returns persisted values rather
  // than racing the disk read. Must be awaited: `getSettings()`
  // populates cache with `DEFAULT_SETTINGS` on first call when cache is
  // still null, and the later `loadSettings()` resolution does not
  // broadcast `settings:changed`, so a fast renderer mount would lock
  // in defaults until the user manually flips a setting. loadSettings
  // swallows its own errors and falls back to defaults internally.
  await loadSettings()

  // Sweep orphan trash entries older than 24h. Fire-and-forget: errors per
  // entry are caught + logged inside trashService; we never block startup.
  void runTrashStartupCleanup()

  // Configure the About panel before the menu wires up `role: 'about'`
  configureAboutPanel()
  createMenu()
  createWindow()

  // Initialize auto updater in production.
  // E2E_DISABLE_UPDATE=1 lets Playwright tests run against a packaged-shaped
  // build without the updater hitting the network or showing toasts.
  if (app.isPackaged && process.env['E2E_DISABLE_UPDATE'] !== '1') {
    initAutoUpdater()
  }

  // Recreate ONLY the main window if it has been closed — the Settings
  // window may still be open, so checking `getAllWindows().length === 0`
  // would incorrectly leave a Settings-only state without a main window
  // when the user clicks the dock icon. `getMainWindow()` already returns
  // null for both the never-created and post-destroy cases.
  app.on('activate', () => {
    if (getMainWindow() === null) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS: Keep app running when all windows are closed (standard behavior)
})
