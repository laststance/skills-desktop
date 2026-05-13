import type { Metadata } from 'next'

import { Hero } from '@/components/Hero'
import { Features } from '@/components/Features'
import { Download } from '@/components/Download'
import { Footer } from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Skills Desktop - AI Agent Skills Manager',
  description:
    'Visualize and manage installed Skills across AI agents, inspect symlink status, and keep local coding tools in sync.',
}

export default function Home() {
  return (
    <main className="min-h-screen">
      <Hero />
      <Features />
      <Download />
      <Footer />
    </main>
  )
}
