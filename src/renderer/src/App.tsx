import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toaster } from 'sonner'

import { ChatPanel } from './components/chat/ChatPanel'
import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useChatNotification } from './hooks/useChatNotification'
import { useUpdateNotification } from './hooks/useUpdateNotification'

/**
 * Skills Desktop main application component
 * Four-column layout: Sidebar (240px) | Main (resizable) | Detail (resizable) | Chat (resizable)
 * Theme application is handled by Redux listener middleware
 */
export default function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()
  // Subscribe to chat chunk IPC events
  useChatNotification()

  return (
    <TooltipProvider delayDuration={200}>
      {/* Window glow effect - subtle inner shadow for depth */}
      <div className="flex h-screen bg-background text-foreground window-glow">
        <Sidebar />
        <Group orientation="horizontal" className="flex-1 h-full">
          <Panel defaultSize="35%" minSize="15%">
            <MainContent />
          </Panel>
          <Separator className="bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize" />
          <Panel defaultSize="35%" minSize="20%">
            <DetailPanel />
          </Panel>
          <Separator className="bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize" />
          {/* 30% ≈ 320px on 1280px window */}
          <Panel defaultSize="30%" minSize="15%" maxSize="40%">
            <ChatPanel />
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
}
