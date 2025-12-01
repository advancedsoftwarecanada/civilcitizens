import './globals.css'
import { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import Toasts from './_components/Toasts'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-[var(--cc-muted-surface)] text-slate-900 antialiased`}>
        {children}
        {modal}
        <Toasts />
      </body>
    </html>
  )
}
