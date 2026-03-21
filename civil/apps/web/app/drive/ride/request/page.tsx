import type { Metadata } from 'next'
import DriveRideRequestPageClient from '../../DriveRideRequestPageClient'

export const metadata: Metadata = {
  title: 'Request Ride',
}

export default function DriveRideRequestPage() {
  return <DriveRideRequestPageClient />
}
