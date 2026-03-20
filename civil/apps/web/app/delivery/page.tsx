import type { Metadata } from 'next'
import DeliveryContractsPageClient from './DeliveryContractsPageClient'

export const metadata: Metadata = {
  title: 'Delivery Contracts',
}

export default function DeliveryPage() {
  return <DeliveryContractsPageClient />
}