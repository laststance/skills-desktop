'use client'

import { Apple, Cpu } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden py-20 lg:py-32">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />

      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-4 py-1.5 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            Now available for macOS
          </div>

          {/* Title */}
          <h1 className="mb-6 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Manage Your AI Agent <span className="gradient-text">Skills</span>{' '}
            in One Place
          </h1>

          {/* Subtitle */}
          <p className="mb-10 max-w-2xl text-lg text-muted-foreground lg:text-xl">
            Visualize installed Skills, check symlink status across 21 AI
            agents, and keep your development tools perfectly synchronized.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <a
              href="https://github.com/laststance/skills-desktop/releases/download/v0.4.1/skills-desktop-0.4.1-arm64.dmg"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 text-lg font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:scale-105"
            >
              <Apple className="h-5 w-5" />
              <div className="text-left">
                <div>Download for Mac</div>
                <div className="text-xs font-normal opacity-80">
                  Apple Silicon (M1/M2/M3/M4)
                </div>
              </div>
            </a>
            <a
              href="https://github.com/laststance/skills-desktop/releases/download/v0.4.1/skills-desktop-0.4.1-x64.dmg"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card/50 px-8 py-3 text-lg font-semibold transition-all hover:bg-card hover:scale-105"
            >
              <Cpu className="h-5 w-5" />
              <div className="text-left">
                <div>Download for Mac</div>
                <div className="text-xs font-normal text-muted-foreground">
                  Intel (x64)
                </div>
              </div>
            </a>
          </div>
          <div className="mt-4">
            <a
              href="https://github.com/laststance/skills-desktop"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              View on GitHub
            </a>
          </div>

          {/* App Screenshot */}
          <div className="relative mt-16 w-full max-w-5xl">
            <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 blur-2xl" />
            <div className="glass relative overflow-hidden rounded-xl shadow-2xl">
              <div className="flex h-8 items-center gap-2 border-b border-border/50 bg-card/80 px-4">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="ml-4 text-sm text-muted-foreground">
                  Skills Desktop
                </span>
              </div>
              <div className="aspect-[16/10] bg-background/50 p-4">
                {/* Placeholder for actual screenshot */}
                <div className="flex h-full gap-4">
                  {/* Sidebar */}
                  <div className="w-60 rounded-lg bg-card/50 p-4">
                    <div className="mb-4 font-mono text-lg font-semibold text-primary">
                      Skills Desktop
                    </div>
                    <div className="space-y-2">
                      <div className="rounded bg-card/50 p-2 text-sm text-muted-foreground">
                        Claude Code
                      </div>
                      <div className="rounded bg-card/50 p-2 text-sm text-muted-foreground">
                        Cursor
                      </div>
                      <div className="rounded bg-card/50 p-2 text-sm text-muted-foreground">
                        Gemini CLI
                      </div>
                    </div>
                  </div>
                  {/* Main content */}
                  <div className="flex-1 rounded-lg bg-card/30 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        'agent-browser',
                        'create-skill',
                        'find-skills',
                        'code-trace',
                      ].map((skill) => (
                        <div
                          key={skill}
                          className="rounded-lg border border-border/50 bg-card/50 p-3"
                        >
                          <div className="font-medium">{skill}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Active in 4 agents
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
