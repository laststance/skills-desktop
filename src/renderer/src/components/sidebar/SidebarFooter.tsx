import { ExternalLink } from 'lucide-react'

const SKILLS_REGISTRY_URL = 'https://skills.sh/'

/**
 * Sidebar footer with external link to skills.sh registry
 * Opens URL in system default browser via Electron shell API
 */
export function SidebarFooter(): React.ReactElement {
  const handleClick = (): void => {
    window.electron.shell.openExternal(SKILLS_REGISTRY_URL)
  }

  return (
    <div className="border-t border-border px-6 py-4">
      <button
        onClick={handleClick}
        className="flex items-center justify-center gap-1.5 w-full text-xs font-medium font-mono text-muted-foreground hover:text-primary transition-colors"
      >
        <span>skills.sh</span>
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  )
}
