import React from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toaster } from 'sonner'

import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useReleaseNotesToast } from './hooks/useReleaseNotesToast'
import { useSettingsSync } from './hooks/useSettingsSync'
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
  // Theme sonner's built-in close button with shadcn popover tokens so it
  // inherits the popover surface in both light/dark modes — sonner's default
  // light/dark borders look pasted-on against our OKLCH background.
  closeButton:
    'bg-popover text-muted-foreground border-border hover:bg-accent hover:text-foreground',
} as const

const toastOptions = {
  classNames: toastClassNames,
} satisfies React.ComponentProps<typeof Toaster>['toastOptions']

/**
 * Inline style on the Toaster itself. Sonner reads `--normal-bg` /
 * `--normal-border` / `--normal-text` off the toaster root and forwards them
 * into its own `[data-sonner-toast][data-styled="true"]` rule, so re-pointing
 * those variables at our shadcn tokens gives the surface the right popover
 * color in both light and dark mode without resorting to `!important` or the
 * `unstyled` escape hatch (which would force us to recreate sonner's entire
 * default layout).
 *
 * The `--toast-close-button-*` overrides seat the built-in × inside the toast
 * at 8px from each edge instead of letting it overhang the corner (sonner's
 * default). Sonner pins the close button to `top: 0`, so we use the transform
 * variable to provide the matching 8px vertical inset.
 *
 * `--width: 312px` overrides sonner's hard-coded `TOAST_WIDTH = 356px`
 * default (set inline on the toaster root in sonner's `index.mjs`, then read
 * by `[data-sonner-toast][data-styled="true"] { width: var(--width) }`). User
 * `style` is spread AFTER sonner's defaults, so this override wins. 312px is
 * narrow enough to remove the dead whitespace sonner's 356px default left to
 * the right of the UndoToast's short summary line, while staying wide enough
 * to fit the longest "Restoring N skills…" label without wrapping, and is a
 * multiple of 4 so it sits on the project's 4px base grid alongside the 8px
 * close-button insets. A fixed value (rather than `fit-content`) keeps the
 * toast width stable across summary lengths, so the close button and Undo
 * button do not shift horizontally as the countdown re-renders. Centering
 * bugs reported in sonner #67/#678 only apply to `position="*-center"` — we
 * use `bottom-right`, which stays anchored to the right edge regardless of
 * width.
 */
const toasterStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--toast-close-button-start': '8px',
  '--toast-close-button-end': 'unset',
  '--toast-close-button-transform': 'translate(0, 8px)',
  '--width': '312px',
} as React.CSSProperties

/**
 * Skills Desktop main application component
 * Layout: Sidebar (240px) | Main | Detail
 * Theme application is handled by Redux listener middleware
 */
const App = React.memo(function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()

  // Hydrate the settings slice from the main-process JSON store and
  // subscribe to cross-window changes broadcast by `settings:set`.
  useSettingsSync()

  // After auto-update + restart, fire a one-shot "What's new" toast on the
  // first launch of the new version with a link to the GitHub release notes.
  useReleaseNotesToast()

  // Drive sonner's theme prop from the persisted redux mode so toasts honor
  // the user's light/dark choice. Pre-fix this was hardcoded `theme="dark"`.
  const mode = useAppSelector((state) => state.theme.mode)

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-testid="window-background-surface"
        className="window-background-surface flex h-screen text-foreground window-glow transition-[background-color]"
        // Renderer paints a solid surface while BrowserWindow.setOpacity controls real desktop transparency.
        style={{ backgroundColor: 'var(--background)' }}
      >
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
        toastOptions={toastOptions}
      />
    </TooltipProvider>
  )
})

export default App
