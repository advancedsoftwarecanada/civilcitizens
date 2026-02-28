import './globals.css'
import { ReactNode, Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Toasts from './_components/Toasts'
import MobileDockVisibility from './_components/MobileDockVisibility'
import TopNavVisibility from './_components/TopNavVisibility'
import ViewerBootstrap from './_components/ViewerBootstrap'
import ScrollManager from './_components/ScrollManager'
import AnalyticsTracker from './_components/AnalyticsTracker'
import GoogleAnalytics from './_components/GoogleAnalytics'
import AppFrame from './_components/AppFrame'
import NotificationTapRouter from './_components/NotificationTapRouter'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

function resolveMetadataBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || '').trim()
  const hostFallback = (process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca').trim()
  const fallback = hostFallback.startsWith('http') ? hostFallback : `https://${hostFallback}`

  if (!raw) return fallback
  const normalized = raw.startsWith('http') ? raw : `https://${raw}`
  if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(normalized)) return fallback
  return normalized
}

const baseUrl = resolveMetadataBaseUrl()

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'Civil Citizens',
    template: '%s | Civil Citizens',
  },
  description:
    'Civil Citizens helps Canadians organize their cities, publish civic updates, and launch trusted organizations backed by verified memberships.',
  applicationName: 'Civil Citizens',
  keywords: ['civic', 'canada', 'organizing', 'cities', 'civil citizens'],
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
  openGraph: {
    title: 'Civil Citizens',
    description:
      'Organize your city, publish updates, and unlock verified non-profit and event pages with Civil Citizens Premium.',
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
    description: 'Organize your city, stay verified, and unlock non-profit tools with Civil Citizens.',
    images: ['/logo-lg.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#CA052D',
}

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-[var(--cc-muted-surface)] text-slate-900 antialiased`}>
        <GoogleAnalytics />
        <TopNavVisibility />
        <ViewerBootstrap />
        <Suspense fallback={null}>
          <NotificationTapRouter />
        </Suspense>
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
        <Suspense fallback={null}>
          <ScrollManager />
        </Suspense>
        <AppFrame modal={modal}>{children}</AppFrame>
        <MobileDockVisibility />
        <Toasts />
      </body>
    </html>
  )
}
