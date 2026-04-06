import React from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toaster } from 'sonner'

import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useUpdateNotification } from './hooks/useUpdateNotification'

const separatorClass =
  'bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize'

/**
 * Skills Desktop main application component
 * Layout: Sidebar (240px) | Main | Detail
 * Theme application is handled by Redux listener middleware
 */
const App = React.memo(function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()

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
        <Group orientation="horizontal" className="flex-1 h-full">
          <Panel defaultSize="50%" minSize="20%">
            <MainContent />
          </Panel>
          <Separator className={separatorClass} />
          <Panel defaultSize="50%" minSize="20%">
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
