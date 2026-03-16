import { redirect } from 'next/navigation'

type InstallAndroidPwaRedirectPageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function InstallAndroidPwaRedirectPage({ searchParams }: InstallAndroidPwaRedirectPageProps) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === 'string' && value) params.set(key, value)
    if (Array.isArray(value) && value[0]) params.set(key, value[0])
  }
  const suffix = params.toString() ? `?${params.toString()}` : ''
  redirect(`/install/android${suffix}`)
}
