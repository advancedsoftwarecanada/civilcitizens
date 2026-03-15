import './globals.css'
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
import IncomingFamilyCallOverlay from './_components/IncomingFamilyCallOverlay'
import IncomingMessageCallOverlay from './_components/IncomingMessageCallOverlay'
import PlaceholderSanitizer from './_components/PlaceholderSanitizer'
import AppScrollbar from './_components/AppScrollbar'
import PushRedirectDebugModal from './_components/PushRedirectDebugModal'
import WebPushDebugModal from './_components/WebPushDebugModal'

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
const launchOverlayBootstrap = `(function(){try{if(window.location.pathname==='/'&&window.localStorage.getItem('token')){document.documentElement.classList.add('cc-launch-pending')}}catch(_error){}})();`
const nativePlatformBootstrap = `(function(){try{var capacitor=window.Capacitor;if(!capacitor||typeof capacitor.getPlatform!=='function')return;var platform=capacitor.getPlatform();if(platform==='ios'){document.documentElement.classList.add('cc-native-ios')}if(platform==='android'){document.documentElement.classList.add('cc-native-android')}}catch(_error){}})();`

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
  other: {
    'mobile-web-app-capable': 'yes',
  },
  keywords: ['civic', 'canada', 'organizing', 'cities', 'civil citizens'],
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/PWA-ICON.png?v=20260306',
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
            <img src="/favicon.png" alt="" className="cc-launch-overlay__logo" />
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
