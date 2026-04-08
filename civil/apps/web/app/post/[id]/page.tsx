import { notFound, redirect } from 'next/navigation'

const CIVIL_PUBLIC_HOST = process.env.CIVIL_PUBLIC_HOST || 'dev.civilcitizens.ca'

const resolveApiBase = () => {
  const rawApiBase = (process.env.NEXT_PUBLIC_API_BASE || '/api').trim()
  if (/^https?:\/\//i.test(rawApiBase)) return rawApiBase.replace(/\/+$/, '')

  const rawPublicBase = (process.env.NEXT_PUBLIC_BASE_URL || `https://${CIVIL_PUBLIC_HOST}`).trim()
  const publicBase = (/^https?:\/\//i.test(rawPublicBase) ? rawPublicBase : `https://${rawPublicBase}`).replace(/\/+$/, '')
  const apiPath = rawApiBase.startsWith('/') ? rawApiBase : `/${rawApiBase}`
  return `${publicBase}${apiPath}`
}

const API_BASE = resolveApiBase()

type PageProps = {
  params: {
    id: string
  }
}

async function loadPostPaths(id: string) {
  const headers = {
    accept: 'application/json',
  }

  const slugRes = await fetch(`${API_BASE}/posts/slug/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers,
  })
  if (slugRes.ok) {
    const payload = (await slugRes.json().catch(() => null)) as { paths?: { community?: string | null; user?: string | null } } | null
    return payload?.paths ?? null
  }
  if (slugRes.status !== 404) {
    throw new Error(`Failed to load post slug ${id}: ${slugRes.status}`)
  }

  const idRes = await fetch(`${API_BASE}/posts/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers,
  })

  if (idRes.status === 404) return null
  if (!idRes.ok) throw new Error(`Failed to load post ${id}: ${idRes.status}`)

  const payload = (await idRes.json().catch(() => null)) as { paths?: { community?: string | null; user?: string | null } } | null
  return payload?.paths ?? null
}

export default async function LegacyPostRedirectPage({ params }: PageProps) {
  const paths = await loadPostPaths(params.id)
  if (!paths) {
    notFound()
  }

  const target = paths.community ?? paths.user
  if (!target) {
    notFound()
  }

  if (target === `/post/${params.id}`) {
    notFound()
  }

  redirect(target)
}
