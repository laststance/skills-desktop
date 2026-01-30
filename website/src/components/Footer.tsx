'use client'

import { Github, Twitter } from 'lucide-react'

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
            >
              <Github className="h-5 w-5" />
            </a>
            <a
              href="https://twitter.com/laaboratory"
              className="text-muted-foreground hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Twitter className="h-5 w-5" />
            </a>
          </div>

          <div className="text-sm text-muted-foreground">
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
