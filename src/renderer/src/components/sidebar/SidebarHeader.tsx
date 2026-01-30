import { ThemeSelector } from '../theme/ThemeSelector'

/**
 * Sidebar header with app title and theme selector
 */
export function SidebarHeader(): React.ReactElement {
  return (
    <div className="p-4 pt-8 drag-region">
      <div className="flex items-center justify-between no-drag">
        <div>
          <h1 className="font-mono text-lg font-semibold text-primary">
            Skills Desktop
          </h1>
          <p className="text-xs text-muted-foreground">v0.1.0</p>
        </div>
        <ThemeSelector />
      </div>
    </div>
  )
}
