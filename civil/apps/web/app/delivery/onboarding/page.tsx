import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Delivery Onboarding',
}

export default function DeliveryOnboardingPage() {
  redirect('/drive/onboarding')
}
