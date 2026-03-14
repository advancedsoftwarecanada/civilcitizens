import { redirect } from 'next/navigation'

type LegacyFamilyEditPageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function LegacyFamilyEditPage({ searchParams }: LegacyFamilyEditPageProps) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') params.append(key, item)
      }
      continue
    }
    if (typeof value === 'string') params.set(key, value)
  }

  const query = params.toString()
  redirect(query ? `/settings/guardian/edit?${query}` : '/settings/guardian/edit')
}
