import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
