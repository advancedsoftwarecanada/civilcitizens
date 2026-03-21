import type { Metadata } from 'next'
import MarketShippingAddressEditorPageClient from '../../../market/_components/MarketShippingAddressEditorPageClient'

export const metadata: Metadata = {
  title: 'Edit Address',
}

export default async function SettingsAddressesEditPage({ params }: { params: Promise<{ addressId: string }> }) {
  const resolved = await params
  return <MarketShippingAddressEditorPageClient addressId={resolved.addressId} context="settings" />
}
