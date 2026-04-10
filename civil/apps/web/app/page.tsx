import type { Metadata } from 'next'
import AutoRedirect from './_components/AutoRedirect'
import MapleRidesLandingPage from './_components/MapleRidesLandingPage'

const homepageDescription =
  'Canada’s Fair Ride Network. Fair pay for drivers. Fair pricing for riders. No surge pricing. Ever.'

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
    title: 'MapleRides',
    description: homepageDescription,
    siteName: 'MapleRides',
    images: [
      {
        url: '/Maple-Rides.png',
        width: 772,
        height: 441,
        alt: 'MapleRides logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MapleRides',
    description: homepageDescription,
    images: ['/Maple-Rides.png'],
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
