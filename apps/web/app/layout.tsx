import type { Metadata } from 'next'
import { Nunito } from 'next/font/google'
import '@kennko/tokens/tokens.css'
import '@kennko/cats/cats.css'
import './globals.css'

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  variable: '--font-nunito',
})

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
    <html lang="en" className={nunito.variable}>
      <body>{children}</body>
    </html>
  )
}
