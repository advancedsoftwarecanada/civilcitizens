import type { Metadata } from 'next'
import DriveLandingPageClient from '../drive/DriveLandingPageClient'

export const metadata: Metadata = {
  title: 'Ride',
}

export default function RidePage() {
  return <DriveLandingPageClient surfaceMode="request" />
}