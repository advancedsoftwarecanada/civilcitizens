import type { Metadata } from 'next'
import DriveContractPageClient from '../../DriveContractPageClient'

export const metadata: Metadata = {
  title: 'Drive Contract',
}

export default async function DriveContractPage({ params }: { params: Promise<{ rideId: string }> }) {
  const resolved = await params
  return <DriveContractPageClient rideId={resolved.rideId} />
}
