import { notFound, redirect } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000'

type PageProps = {
  params: {
    id: string
  }
}

async function loadPostPaths(id: string) {
  const res = await fetch(`${API_BASE}/posts/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
  })

  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to load post ${id}: ${res.status}`)

  const payload = (await res.json().catch(() => null)) as { paths?: { community?: string | null; user?: string | null } } | null
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
