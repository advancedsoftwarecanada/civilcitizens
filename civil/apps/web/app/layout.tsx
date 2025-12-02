import './globals.css'
import { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Toasts from './_components/Toasts'
import MobileDock from './_components/MobileDock'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

const baseUrl = 'https://app.civilcitizens.dev'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'Civil Citizens',
    template: '%s | Civil Citizens',
  },
  description:
    'Civil Citizens helps Canadians organize chambers, publish civic updates, and launch trusted organizations backed by verified memberships.',
  applicationName: 'Civil Citizens',
  keywords: ['civic', 'canada', 'organizing', 'chambers', 'civil citizens'],
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
  themeColor: '#CA052D',
  openGraph: {
    title: 'Civil Citizens',
    description:
      'Organize your riding, publish updates, and unlock verified non-profit and event pages with Civil Citizens Premium.',
    url: baseUrl,
    siteName: 'Civil Citizens',
    images: [
      {
        url: '/logo-lg.png',
        width: 1200,
        height: 630,
        alt: 'Civil Citizens logo',
      },
    ],
    locale: 'en_CA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Civil Citizens',
    description: 'Organize your chamber, stay verified, and unlock non-profit tools with Civil Citizens.',
    images: ['/logo-lg.png'],
  },
}

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-[var(--cc-muted-surface)] text-slate-900 antialiased`}>
        {children}
        {modal}
        <MobileDock />
        <Toasts />
      </body>
    </html>
  )
}
