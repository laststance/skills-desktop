import { Panel, Group, Separator } from 'react-resizable-panels'

import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useUpdateNotification } from './hooks/useUpdateNotification'

/**
 * Skills Desktop main application component
 * Three-column layout: Sidebar (240px) | Main (resizable) | Detail (resizable)
 * Theme application is handled by Redux listener middleware
 */
export default function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()

  return (
    <TooltipProvider delayDuration={200}>
      {/* Window glow effect - subtle inner shadow for depth */}
      <div className="flex h-screen bg-background text-foreground window-glow">
        <Sidebar />
        <Group orientation="horizontal" className="flex-1 h-full">
          <Panel defaultSize={40} minSize={20}>
            <MainContent />
          </Panel>
          <Separator className="bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize" />
          <Panel defaultSize={60} minSize={30}>
            <DetailPanel />
          </Panel>
        </Group>
      </div>
      {/* Auto-update toast notification */}
      <UpdateToast />
    </TooltipProvider>
  )
}
