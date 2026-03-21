import type { Metadata } from 'next'
import DriveDeliveryPageClient from '../DriveDeliveryPageClient'

export const metadata: Metadata = {
  title: 'Drive Delivery Requests',
}

export default function DriveDeliveryPage() {
  return <DriveDeliveryPageClient />
}
