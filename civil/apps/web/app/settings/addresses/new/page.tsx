import type { Metadata } from 'next'
import MarketShippingAddressEditorPageClient from '../../../market/_components/MarketShippingAddressEditorPageClient'

export const metadata: Metadata = {
  title: 'Add Address',
}

export default function SettingsAddressesNewPage() {
  return <MarketShippingAddressEditorPageClient context="settings" />
}
