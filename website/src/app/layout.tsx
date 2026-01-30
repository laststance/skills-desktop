import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://skills-desktop.vercel.app'),
  title: 'Skills Desktop - AI Agent Skills Manager',
  description:
    'Visualize and manage installed Skills across 21 AI agents. See symlink status, discover skills, and keep your AI tools in sync.',
  keywords: ['AI', 'Claude Code', 'Skills', 'Desktop App', 'macOS', 'Electron'],
  authors: [{ name: 'Laststance.io' }],
  openGraph: {
    title: 'Skills Desktop - AI Agent Skills Manager',
    description: 'Visualize and manage installed Skills across 21 AI agents',
    url: 'https://skills-desktop.vercel.app',
    siteName: 'Skills Desktop',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Skills Desktop App Screenshot',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Skills Desktop - AI Agent Skills Manager',
    description: 'Visualize and manage installed Skills across 21 AI agents',
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans`}>
        {children}
      </body>
    </html>
  )
}
