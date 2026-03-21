import type { Metadata } from 'next'
import DriveRideOffersPageClient from '../../../DriveRideOffersPageClient'

export const metadata: Metadata = {
  title: 'Ride Offers',
}

export default async function DriveRideOffersPage({ params }: { params: Promise<{ rideId: string }> }) {
  const resolved = await params
  return <DriveRideOffersPageClient rideId={resolved.rideId} />
}
