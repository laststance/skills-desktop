import React, { useCallback, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import { Panel, Group, Separator, usePanelRef } from 'react-resizable-panels'
import { Toaster } from 'sonner'

import { FEATURE_FLAGS } from '../../shared/featureFlags'

import { ChatPanel } from './components/chat/ChatPanel'
import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useChatNotification } from './hooks/useChatNotification'
import { useUpdateNotification } from './hooks/useUpdateNotification'

const separatorClass =
  'bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize'

/**
 * Skills Desktop main application component
 * Layout depends on ENABLE_CHAT_PANEL feature flag:
 * - ON:  Sidebar (240px) | Main | Chat | Inspector (collapsible)
 * - OFF: Sidebar (240px) | Main | Detail (always visible)
 * Theme application is handled by Redux listener middleware
 */
const App = React.memo(function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()
  // Subscribe to chat chunk IPC events (only when chat is enabled)
  useChatNotification({ enabled: FEATURE_FLAGS.ENABLE_CHAT_PANEL })

  // Collapsible inspector state (only used when chat panel is active)
  const detailPanelRef = usePanelRef()
  const [isDetailCollapsed, setIsDetailCollapsed] = useState(true)

  const handleDetailResize = useCallback((panelSize: PanelSize) => {
    setIsDetailCollapsed(panelSize.asPercentage === 0)
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:left-0 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:p-2"
      >
        Skip to main content
      </a>
      {/* Window glow effect - subtle inner shadow for depth */}
      <div className="flex h-screen bg-background text-foreground window-glow">
        <Sidebar />
        {FEATURE_FLAGS.ENABLE_CHAT_PANEL ? (
          <Group orientation="horizontal" className="flex-1 h-full">
            <Panel defaultSize="50%" minSize="20%">
              <MainContent />
            </Panel>
            <Separator className={separatorClass} />
            <Panel defaultSize="50%" minSize="20%">
              <ChatPanel />
            </Panel>
            {/* Inspector separator — hidden when panel is collapsed */}
            <Separator
              className={`${separatorClass} ${isDetailCollapsed ? 'opacity-0 pointer-events-none w-0' : ''}`}
            />
            {/* Collapsible Inspector panel (Apple HIG Inspector pattern) */}
            <Panel
              panelRef={detailPanelRef}
              collapsible
              collapsedSize={0}
              defaultSize="0%"
              minSize="25%"
              maxSize="40%"
              onResize={handleDetailResize}
            >
              <DetailPanel />
            </Panel>
          </Group>
        ) : (
          <Group orientation="horizontal" className="flex-1 h-full">
            <Panel defaultSize="50%" minSize="20%">
              <MainContent />
            </Panel>
            <Separator className={separatorClass} />
            <Panel defaultSize="50%" minSize="20%">
              <DetailPanel />
            </Panel>
          </Group>
        )}
      </div>
      {/* Auto-update toast notification */}
      <UpdateToast />
      {/* Sonner toast notifications */}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          className: 'bg-slate-800 border-slate-700 text-white',
        }}
      />
    </TooltipProvider>
  )
})

export default App
