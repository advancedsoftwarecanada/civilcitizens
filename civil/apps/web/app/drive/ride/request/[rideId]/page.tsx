import type { Metadata } from 'next'
import DriveRideRequestPageClient from '../../../DriveRideRequestPageClient'

export const metadata: Metadata = {
  title: 'Edit Ride Request',
}

export default async function DriveRideRequestEditPage({ params }: { params: Promise<{ rideId: string }> }) {
  const resolved = await params
  return <DriveRideRequestPageClient mode="edit" rideId={resolved.rideId} />
}
