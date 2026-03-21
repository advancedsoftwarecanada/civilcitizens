import type { Metadata } from 'next'
import DriveRidePageClient from '../DriveRidePageClient'

export const metadata: Metadata = {
  title: 'Drive Ride Requests',
}

export default function DriveRidePage() {
  return <DriveRidePageClient />
}
