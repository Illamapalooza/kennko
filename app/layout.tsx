import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kennko Coffee — Bold coffee. Fun sips. Good energy.',
  description:
    'Kennko Coffee is a bold, playful cafe on CT. Montalban St., Villa Kananga, Butuan City serving premium coffee, non-coffee favorites, and signature specialty drinks.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
