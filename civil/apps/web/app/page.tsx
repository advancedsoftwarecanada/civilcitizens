import type { Metadata } from 'next'
import AutoRedirect from './_components/AutoRedirect'
import MapleRidesLandingPage from './_components/MapleRidesLandingPage'

const homepageDescription =
  'A Canadian app for booking rides and driving for hire. A Canadian alternative to Uber and Lyft with no surge pricing.'

const homepageSocialTitle = 'MapleRides | A Canadian app for booking rides and driving for hire'

export const metadata: Metadata = {
  title: {
    absolute: 'MapleRides',
  },
  description: homepageDescription,
  icons: {
    icon: '/Maple-Rides-Favicon.png',
    shortcut: '/Maple-Rides-Favicon.png',
    apple: '/Maple-Rides-Favicon.png',
  },
  openGraph: {
    title: homepageSocialTitle,
    description: homepageDescription,
    siteName: 'MapleRides',
    images: [
      {
        url: '/Maple-Rides-ca-opengraph.jpg',
        alt: 'MapleRides Canada share image',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: homepageSocialTitle,
    description: homepageDescription,
    images: ['/Maple-Rides-ca-opengraph.jpg'],
  },
}

export default function Home() {
  return (
    <>
      <AutoRedirect />
      <MapleRidesLandingPage />
    </>
  )
}
