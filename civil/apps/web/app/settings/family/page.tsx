import { redirect } from 'next/navigation'

export default function LegacyFamilySettingsPage() {
  redirect('/settings/guardian')
}
