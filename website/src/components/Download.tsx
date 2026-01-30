'use client'

import { Apple, Cpu, Download as DownloadIcon } from 'lucide-react'

export function Download() {
  return (
    <section className="py-20 lg:py-32">
      <div className="container mx-auto px-4">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card/30">
          {/* Background decoration */}
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />

          <div className="relative p-8 sm:p-12 lg:p-16">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Ready to Get Started?
              </h2>
              <p className="mb-10 text-lg text-muted-foreground">
                Download Skills Desktop for macOS and take control of your AI
                agent skills today. Available for both Apple Silicon and Intel
                Macs.
              </p>

              {/* Download buttons */}
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <a
                  href="https://github.com/laststance/skills-desktop/releases/latest/download/Skills-Desktop-arm64.dmg"
                  className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:scale-105 sm:w-auto"
                >
                  <Apple className="h-6 w-6" />
                  <div className="text-left">
                    <div>Download for Mac</div>
                    <div className="text-xs font-normal opacity-80">
                      Apple Silicon (M1/M2/M3)
                    </div>
                  </div>
                </a>

                <a
                  href="https://github.com/laststance/skills-desktop/releases/latest/download/Skills-Desktop-x64.dmg"
                  className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card/50 px-8 py-4 text-lg font-semibold transition-all hover:bg-card hover:scale-105 sm:w-auto"
                >
                  <Cpu className="h-6 w-6" />
                  <div className="text-left">
                    <div>Download for Mac</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      Intel (x64)
                    </div>
                  </div>
                </a>
              </div>

              {/* Alternative download */}
              <div className="mt-8">
                <a
                  href="https://github.com/laststance/skills-desktop/releases"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <DownloadIcon className="h-4 w-4" />
                  View all releases on GitHub
                </a>
              </div>

              {/* System requirements */}
              <div className="mt-12 rounded-lg border border-border/50 bg-background/50 p-4">
                <h3 className="mb-2 text-sm font-semibold">
                  System Requirements
                </h3>
                <p className="text-sm text-muted-foreground">
                  macOS 12.0 (Monterey) or later • 50 MB disk space • Arm64 or
                  x64 processor
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
