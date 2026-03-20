import type { Metadata } from 'next'
import DeliveryOnboardingPageClient from './DeliveryOnboardingPageClient'

export const metadata: Metadata = {
  title: 'Delivery Onboarding',
}

export default function DeliveryOnboardingPage() {
  return <DeliveryOnboardingPageClient />
}