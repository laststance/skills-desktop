import React, { useCallback, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import { Panel, Group, Separator, usePanelRef } from 'react-resizable-panels'
import { Toaster } from 'sonner'

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
 * Three-column layout: Sidebar (240px) | Main (resizable) | Chat (resizable)
 * + Collapsible Inspector panel (Apple HIG pattern) for skill details
 * Theme application is handled by Redux listener middleware
 */
const App = React.memo(function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()
  // Subscribe to chat chunk IPC events
  useChatNotification()

  const detailPanelRef = usePanelRef()
  const [isDetailCollapsed, setIsDetailCollapsed] = useState(true)

  const handleDetailResize = useCallback((panelSize: PanelSize) => {
    setIsDetailCollapsed(panelSize.asPercentage === 0)
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      {/* Window glow effect - subtle inner shadow for depth */}
      <div className="flex h-screen bg-background text-foreground window-glow">
        <Sidebar />
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
