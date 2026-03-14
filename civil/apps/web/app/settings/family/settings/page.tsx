import { redirect } from 'next/navigation'

export default function LegacyFamilyLockedSettingsPage() {
  redirect('/settings/guardian/settings')
}
