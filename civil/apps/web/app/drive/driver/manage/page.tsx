import type { Metadata } from 'next'
import DriveDriverManagePageClient from '../../DriveDriverManagePageClient'

export const metadata: Metadata = {
  title: 'Manage Driver Vehicles',
}

export default function DriveDriverManagePage() {
  return <DriveDriverManagePageClient />
}
