import { redirect } from 'next/navigation'

export default function LegacyFamilyNewPage() {
  redirect('/settings/guardian/new')
}
