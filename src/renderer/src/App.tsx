import React from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toaster } from 'sonner'

import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useReleaseNotesToast } from './hooks/useReleaseNotesToast'
import { useUpdateNotification } from './hooks/useUpdateNotification'
import { useAppSelector } from './redux/hooks'

const separatorClass =
  'bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize'

/**
 * Per-element class names for sonner toasts. Wires shadcn theme tokens
 * (--popover, --primary, etc.) into sonner's per-slot hooks so toasts visually
 * match the rest of the app — popover-style surface, themed action button,
 * themed border — while inheriting sonner's default border-radius/padding/layout.
 *
 * Pre-fix the Toaster passed `toastOptions.className` (a single string),
 * styling the outer container with `bg-slate-800 border-slate-700 text-white`.
 * That clobbered sonner's themed tokens but left the action button and the
 * countdown row untouched, so the `Undo` button rendered as a generic
 * light-grey pill and the `2s` countdown sat unaligned. `classNames` exposes
 * per-slot hooks that match sonner's internal layout, fixing both.
 *
 * Direct (non-group-prefixed) Tailwind tokens are used because this project is
 * on Tailwind v4: the legacy shadcn pattern `group-[.toaster]:bg-popover`
 * relies on v3's arbitrary-class group selector and will silently no-op here.
 *
 * `rounded-lg` and `shadow-lg` win against sonner's defaults because sonner
 * does not set its own border-radius/box-shadow on `data-styled="true"`. The
 * surface color is driven by sonner's CSS variables (`--normal-bg`,
 * `--normal-text`, `--normal-border`) — see `toasterStyle` below — because
 * sonner's `[data-sonner-toast][data-styled="true"]` rule outranks a plain
 * `.bg-popover` utility on specificity, so the variable override is the only
 * route that survives.
 */
const toastClassNames = {
  toast: 'rounded-lg shadow-lg',
  title: 'text-popover-foreground',
  description: 'text-muted-foreground',
  actionButton: 'bg-primary text-primary-foreground hover:bg-primary/90',
  cancelButton: 'bg-muted text-muted-foreground hover:bg-muted/80',
} as const

/**
 * Inline style on the Toaster itself. Sonner reads `--normal-bg` /
 * `--normal-border` / `--normal-text` off the toaster root and forwards them
 * into its own `[data-sonner-toast][data-styled="true"]` rule, so re-pointing
 * those variables at our shadcn tokens gives the surface the right popover
 * color in both light and dark mode without resorting to `!important` or the
 * `unstyled` escape hatch (which would force us to recreate sonner's entire
 * default layout).
 */
const toasterStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
} as React.CSSProperties

/**
 * Skills Desktop main application component
 * Layout: Sidebar (240px) | Main | Detail
 * Theme application is handled by Redux listener middleware
 */
const App = React.memo(function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()

  // After auto-update + restart, fire a one-shot "What's new" toast on the
  // first launch of the new version with a link to the GitHub release notes.
  useReleaseNotesToast()

  // Drive sonner's theme prop from the persisted redux mode so toasts honor
  // the user's light/dark choice. Pre-fix this was hardcoded `theme="dark"`.
  const mode = useAppSelector((state) => state.theme.mode)

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
        theme={mode}
        className="toaster group"
        style={toasterStyle}
        toastOptions={{ classNames: toastClassNames }}
      />
    </TooltipProvider>
  )
})

export default App
