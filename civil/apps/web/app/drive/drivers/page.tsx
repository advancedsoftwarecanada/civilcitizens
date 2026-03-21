import type { Metadata } from 'next'
import DriveDriversPageClient from '../DriveDriversPageClient'

export const metadata: Metadata = {
  title: 'Drive Drivers',
}

export default function DriveDriversPage() {
  return <DriveDriversPageClient />
}
