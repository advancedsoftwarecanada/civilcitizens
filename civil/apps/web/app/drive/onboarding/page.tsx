import type { Metadata } from 'next'
import DeliveryOnboardingPageClient from '../../delivery/onboarding/DeliveryOnboardingPageClient'

export const metadata: Metadata = {
  title: 'Drive Onboarding',
}

export default function DriveOnboardingPage() {
  return <DeliveryOnboardingPageClient />
}
