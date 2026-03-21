import type { Metadata } from 'next'
import DriveLandingPageClient from './DriveLandingPageClient'

export const metadata: Metadata = {
  title: 'Drive',
}

export default function DrivePage() {
  return <DriveLandingPageClient />
}
