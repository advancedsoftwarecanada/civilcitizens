import './globals.css'
import './politics.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ReactNode, Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Toasts from './_components/Toasts'
import MobileDockVisibility from './_components/MobileDockVisibility'
import TopNavVisibility from './_components/TopNavVisibility'
import ViewerBootstrap from './_components/ViewerBootstrap'
import FamilyViewBootstrap from './_components/FamilyViewBootstrap'
import ScrollManager from './_components/ScrollManager'
import AnalyticsTracker from './_components/AnalyticsTracker'
import GoogleAnalytics from './_components/GoogleAnalytics'
import AppFrame from './_components/AppFrame'
import NotificationTapRouter from './_components/NotificationTapRouter'
import NativeViewportInsets from './_components/NativeViewportInsets'
import NativeKeyboardUi from './_components/NativeKeyboardUi'
import PushRegistrationSync from './_components/PushRegistrationSync'
import IosOpenInAppBanner from './_components/IosOpenInAppBanner'
import LaunchOverlayCleanup from './_components/LaunchOverlayCleanup'
import CauseContributionNotificationAudio from './_components/CauseContributionNotificationAudio'
import DriveRequesterNotificationAudio from './_components/DriveRequesterNotificationAudio'
import IncomingFamilyCallOverlay from './_components/IncomingFamilyCallOverlay'
import IncomingMessageCallOverlay from './_components/IncomingMessageCallOverlay'
import PlaceholderSanitizer from './_components/PlaceholderSanitizer'
import AppScrollbar from './_components/AppScrollbar'
import PushRedirectDebugModal from './_components/PushRedirectDebugModal'
import WebPushDebugModal from './_components/WebPushDebugModal'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

function resolveMetadataBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || '').trim()
  const hostFallback = (process.env.CIVIL_PUBLIC_HOST || 'dev.maplerides.ca').trim()
  const fallback = hostFallback.startsWith('http') ? hostFallback : `https://${hostFallback}`

  if (!raw) return fallback
  const normalized = raw.startsWith('http') ? raw : `https://${raw}`
  if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(normalized)) return fallback
  return normalized
}

const baseUrl = resolveMetadataBaseUrl()
const launchOverlayBootstrap = `(function(){try{if(window.location.pathname==='/'&&window.localStorage.getItem('token')){document.documentElement.classList.add('cc-launch-pending')}}catch(_error){}})();`
const nativePlatformBootstrap = `(function(){try{var capacitor=window.Capacitor;if(!capacitor||typeof capacitor.getPlatform!=='function')return;var platform=capacitor.getPlatform();if(platform==='ios'){document.documentElement.classList.add('cc-native-ios')}if(platform==='android'){document.documentElement.classList.add('cc-native-android')}}catch(_error){}})();`

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'MapleRides',
    template: '%s | MapleRides',
  },
  description:
    'MapleRides is a Canadian-owned rides platform with fair pay for drivers, fair pricing for riders, and secure payments.',
  applicationName: 'MapleRides',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MapleRides',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  keywords: ['rides', 'canada', 'drivers', 'riders', 'maplerides'],
  icons: {
    icon: '/Maple-Rides-Favicon.png',
    shortcut: '/Maple-Rides-Favicon.png',
    apple: '/Maple-Rides-Favicon.png',
  },
  openGraph: {
    title: 'MapleRides',
    description:
      'MapleRides is a Canadian-owned rides platform built for fair pay, fair pricing, and secure payments.',
    url: baseUrl,
    siteName: 'MapleRides',
    images: [
      {
        url: '/Maple-Rides.png',
        width: 1200,
        height: 630,
        alt: 'MapleRides logo',
      },
    ],
    locale: 'en_CA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MapleRides',
    description: 'MapleRides is a Canadian-owned rides platform with fair pay for drivers and fair pricing for riders.',
    images: ['/Maple-Rides.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#CA052D',
}

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-[var(--cc-muted-surface)] text-slate-900 antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: nativePlatformBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: launchOverlayBootstrap }} />
        <div id="cc-launch-overlay" aria-hidden="true">
          <div className="cc-launch-overlay__glow" />
          <div className="cc-launch-overlay__content">
            <img src="/Maple-Rides-Favicon.png" alt="" className="cc-launch-overlay__logo" />
            <span className="cc-launch-overlay__spinner" aria-hidden="true" />
          </div>
        </div>
        <div id="cc-app-root">
          <GoogleAnalytics />
          <PlaceholderSanitizer />
          <TopNavVisibility />
          <ViewerBootstrap />
          <FamilyViewBootstrap />
          <LaunchOverlayCleanup />
          <CauseContributionNotificationAudio />
          <DriveRequesterNotificationAudio />
          <NativeViewportInsets />
          <NativeKeyboardUi />
          <PushRegistrationSync />
          <Suspense fallback={null}>
            <NotificationTapRouter />
          </Suspense>
          <Suspense fallback={null}>
            <PushRedirectDebugModal />
          </Suspense>
          <Suspense fallback={null}>
            <WebPushDebugModal />
          </Suspense>
          <Suspense fallback={null}>
            <AnalyticsTracker />
          </Suspense>
          <Suspense fallback={null}>
            <ScrollManager />
          </Suspense>
          <IosOpenInAppBanner />
          <AppFrame modal={modal}>{children}</AppFrame>
          <IncomingFamilyCallOverlay />
          <IncomingMessageCallOverlay />
          <AppScrollbar />
          <MobileDockVisibility />
          <Toasts />
        </div>
      </body>
    </html>
  )
}
