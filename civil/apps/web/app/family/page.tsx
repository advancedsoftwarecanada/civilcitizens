import { redirect } from 'next/navigation'

export default function FamilyPage() {
  redirect('/friends?tab=family')
}
