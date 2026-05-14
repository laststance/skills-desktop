'use client'

// Brand logos (GitHub / X) were removed in lucide-react v1 for trademark
// reasons. We inline the SVG paths from simple-icons (CC0) so the footer
// keeps the correct brand mark.
function GithubBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.11.82-.26.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.565 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function XBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-border py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold text-primary">
              Skills Desktop
            </span>
            <span className="text-sm text-muted-foreground">
              by Laststance.io
            </span>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="https://github.com/laststance/skills-desktop"
              className="text-muted-foreground hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
            >
              <GithubBrandIcon className="size-5" />
            </a>
            <a
              href="https://twitter.com/laaboratory"
              className="text-muted-foreground hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
            >
              <XBrandIcon className="size-5" />
            </a>
          </div>

          <div
            className="text-sm text-muted-foreground"
            suppressHydrationWarning
          >
            © {new Date().getFullYear()} Laststance.io. MIT License.
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
          <a href="https://agentskills.io" className="hover:text-foreground">
            Skills Specification
          </a>
          <span>•</span>
          <a href="https://skills.sh" className="hover:text-foreground">
            Skills Registry
          </a>
          <span>•</span>
          <a
            href="https://github.com/vercel-labs/skills"
            className="hover:text-foreground"
          >
            Skills CLI
          </a>
        </div>
      </div>
    </footer>
  )
}
