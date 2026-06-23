import type { Metadata } from 'next'
import { Bebas_Neue, JetBrains_Mono, Outfit } from 'next/font/google'
import './globals.css'
import { SearchProvider } from '@/lib/search-context'

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas',
  display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

const outfit = Outfit({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Insu — Everyday Risk, Instantly Covered',
  description:
    'Parametric event-protection marketplace. Buy protection against real-life disruptions. Automatic payouts when triggers occur.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${bebasNeue.variable} ${jetBrainsMono.variable} ${outfit.variable}`}>
      <body className="min-h-screen antialiased">
        <SearchProvider>{children}</SearchProvider>
      </body>
    </html>
  )
}
