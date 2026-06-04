'use client'

import { Monitor, Link2, Palette, Bot, FolderSync, Eye } from 'lucide-react'

const features = [
  {
    icon: Bot,
    title: '54 AI Agents Supported',
    description:
      'Claude Code, Cursor, Gemini CLI, OpenAI Codex, GitHub Copilot, and dozens more agents auto-detected.',
  },
  {
    icon: Link2,
    title: 'Symlink Status at a Glance',
    description:
      'See valid, broken, inaccessible, or missing symlinks for each skill across all your AI agents instantly.',
  },
  {
    icon: Palette,
    title: '27 Theme Presets',
    description:
      '44 visual themes across OKLCH color hues, pure neutrals, and shadcn/ui tinted neutrals.',
  },
  {
    icon: FolderSync,
    title: 'Centralized Skills Hub',
    description:
      'All skills stored in ~/.agents/skills/ and symlinked to each agent. One source of truth.',
  },
  {
    icon: Monitor,
    title: 'Native macOS Experience',
    description:
      'Built with Electron for a smooth, responsive desktop experience with system integration.',
  },
  {
    icon: Eye,
    title: 'Real-time Monitoring',
    description:
      'Watch your skills directory and get instant updates when skills are added or modified.',
  },
]

export function Features() {
  return (
    <section className="py-20 lg:py-32">
      <div className="container mx-auto px-4">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything You Need to Manage Skills
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            A comprehensive tool designed for developers who use multiple AI
            coding assistants.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group relative rounded-xl border border-border bg-card/30 p-6 transition-all hover:border-primary/50 hover:bg-card/50"
            >
              <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-3 text-primary">
                <feature.icon className="size-6" />
              </div>
              <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-20">
          <p className="mb-8 text-center text-sm text-muted-foreground">
            Works with your favorite AI coding assistants
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-60">
            {[
              'Claude Code',
              'Cursor',
              'Gemini CLI',
              'GitHub Copilot',
              'OpenAI Codex',
              'Cline',
              'Aider',
              'Continue',
            ].map((agent) => (
              <div
                key={agent}
                className="font-mono text-sm text-muted-foreground"
              >
                {agent}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
