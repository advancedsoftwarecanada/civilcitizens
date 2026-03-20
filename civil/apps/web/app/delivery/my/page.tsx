import type { Metadata } from 'next'
import DeliveryMyPageClient from './DeliveryMyPageClient'

export const metadata: Metadata = {
  title: 'My Deliveries',
}

export default function DeliveryMyPage() {
  return <DeliveryMyPageClient />
}