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
import IosPwaPushPrompt from './_components/IosPwaPushPrompt'
import IosOpenInAppBanner from './_components/IosOpenInAppBanner'

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
    'Civil Citizens is completely free for Canadians to organize their cities, publish civic updates, and launch trusted organizations.',
  applicationName: 'Civil Citizens',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Civil Citizens',
  },
  keywords: ['civic', 'canada', 'organizing', 'cities', 'civil citizens'],
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/PWA-ICON.jpg?v=20260303',
  },
  openGraph: {
    title: 'Civil Citizens',
    description:
      'Civil Citizens is completely free for everyone to organize cities, publish updates, and build trusted organizations.',
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
    description: 'Civil Citizens is completely free for everyone to organize cities, share updates, and build trusted organizations.',
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
        <IosPwaPushPrompt />
        <IosOpenInAppBanner />
        <AppFrame modal={modal}>{children}</AppFrame>
        <MobileDockVisibility />
        <Toasts />
      </body>
    </html>
  )
}
