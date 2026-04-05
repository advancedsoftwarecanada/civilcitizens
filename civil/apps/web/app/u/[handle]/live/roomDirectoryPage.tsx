import Link from 'next/link'
import LinkedText from '../../../_components/LinkedText'
import { buildApiUrl } from '../../../_lib/api'

type LivesResponse = {
  user?: {
    handle?: string
    name?: string | null
  }
  items?: Array<{
    id: string
    title?: string
    description?: string | null
    status?: 'ACTIVE' | 'ARCHIVED'
    visibility?: 'PUBLIC' | 'PRIVATE'
  }>
}

export default async function UserLiveRoomDirectoryPage({ handle }: { handle: string }) {
  let data: LivesResponse | null = null
  try {
    const res = await fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/live`), { cache: 'no-store' })
    if (res.ok) {
      data = (await res.json().catch(() => null)) as LivesResponse | null
    }
  } catch {
    data = null
  }

  const items = Array.isArray(data?.items) ? data.items : []

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Live</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{data?.user?.name?.trim() || data?.user?.handle?.trim() || handle}&apos;s live spaces</h1>
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.status === 'ACTIVE' ? 'Live' : 'Space'}</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">{item.title?.trim() || 'Untitled live space'}</h2>
            <LinkedText text={item.description} emptyFallback="No description yet." className="mt-3 text-sm text-slate-600" lineClampClassName="line-clamp-3" />
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{item.visibility === 'PRIVATE' ? 'Private' : 'Public'}</span>
              <Link href={`/u/${encodeURIComponent(handle)}/live/${encodeURIComponent(item.id)}`} className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
                Open room
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}