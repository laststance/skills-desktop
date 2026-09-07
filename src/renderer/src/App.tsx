import React from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'

import { AppToaster } from './components/AppToaster'
import { BackgroundCanvas } from './components/background/BackgroundCanvas'
import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useActivitySync } from './hooks/useActivitySync'
import { useReleaseNotesToast } from './hooks/useReleaseNotesToast'
import { useSettingsSync } from './hooks/useSettingsSync'
import { useUpdateNotification } from './hooks/useUpdateNotification'
import { useAppSelector } from './redux/hooks'
import { getWindowSurfaceStyle } from './utils/getWindowSurfaceStyle'

const separatorClass =
  'bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize'

/**
 * Skills Desktop main application component
 * Layout: Sidebar (272px) | Main | Detail, with independently controlled section opacity.
 * Theme application is handled by Redux listener middleware
 */
const App = function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()

  // Hydrate the settings slice from the main-process JSON store and
  // subscribe to cross-window changes broadcast by `settings:set`.
  useSettingsSync()

  // Hydrate + live-update the Activity Timeline from the main-process event
  // log. No-op while the experimental dashboard flag is off (fully dark).
  useActivitySync()

  // After auto-update + restart, fire a one-shot "What's new" toast on the
  // first launch of the new version with a link to the GitHub release notes.
  useReleaseNotesToast()

  const entireOpacity = useAppSelector(
    (state) => state.settings.windowBackgroundOpacityPercent,
  )
  const opacityMode = useAppSelector(
    (state) => state.settings.windowOpacityMode,
  )
  const leftOpacity = useAppSelector(
    (state) => state.settings.leftSectionOpacityPercent,
  )
  const centerOpacity = useAppSelector(
    (state) => state.settings.centerSectionOpacityPercent,
  )
  const rightOpacity = useAppSelector(
    (state) => state.settings.rightSectionOpacityPercent,
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-testid="window-background-surface"
        data-opacity-mode={opacityMode}
        className="window-background-surface relative isolate flex h-screen bg-transparent text-foreground window-glow"
      >
        <BackgroundCanvas />
        {/* Each pane inherits background alpha; foreground opacity and floating UI stay independent. */}
        <div
          data-window-section="left"
          className="window-surface flex h-full shrink-0"
          style={getWindowSurfaceStyle(opacityMode, leftOpacity, entireOpacity)}
        >
          <Sidebar />
        </div>
        <Group orientation="horizontal" className="flex-1 h-full">
          <Panel defaultSize="50%" minSize="20%">
            <div
              data-window-section="center"
              className="window-surface h-full bg-background"
              style={getWindowSurfaceStyle(
                opacityMode,
                centerOpacity,
                entireOpacity,
              )}
            >
              <MainContent />
            </div>
          </Panel>
          <Separator className={separatorClass} />
          <Panel defaultSize="50%" minSize="20%">
            <div
              data-window-section="right"
              className="window-surface h-full"
              style={getWindowSurfaceStyle(
                opacityMode,
                rightOpacity,
                entireOpacity,
              )}
            >
              <DetailPanel />
            </div>
          </Panel>
        </Group>
      </div>
      {/* Auto-update toast notification */}
      <UpdateToast />
      {/* Sonner toast notifications */}
      <AppToaster />
    </TooltipProvider>
  )
}

export default App
