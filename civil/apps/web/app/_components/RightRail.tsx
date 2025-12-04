import Link from 'next/link'

const exploreLinks = [
  { label: 'Browse Cities', href: '/chambers', description: 'Find your city and explore civic activity.' },
  { label: 'Update your profile', href: '/profile', description: 'Add a bio, avatar, and city details.' },
]

const upcomingHighlights = [
  { title: 'Community Spotlights', detail: 'Weekly features on cities creating impact.' },
  { title: 'Civic Actions', detail: 'Tools to coordinate petitions, meetups, and volunteer drives.' },
  { title: 'Partner Programs', detail: 'Vetted local businesses and employers supporting cities and EDAs.' },
]

export function RightRail() {
  return (
    <div className="sticky top-8 space-y-4">
      <section className="surface-card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">For you</h2>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Beta</span>
        </div>
        <p className="text-sm text-slate-500">
          We&apos;ll recommend cities, citizens, and civic actions as this feed fills with activity.
        </p>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Following at least three cities helps train your personalized feed.
        </div>
      </section>

      <section className="surface-card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Explore Canada</h2>
        <ul className="space-y-3">
          {exploreLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="block rounded-xl border border-slate-100 px-3 py-2 transition hover:border-slate-200">
                <div className="text-sm font-semibold text-[var(--cc-primary)]">{link.label}</div>
                <p className="text-xs text-slate-500">{link.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Coming soon</h2>
        <p className="text-sm text-slate-500">
          Fresh drops rolling out as Civil Citizens opens to more cities across Canada.
        </p>
        <ul className="space-y-3 text-sm text-slate-600">
          {upcomingHighlights.map((item) => (
            <li key={item.title} className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="font-semibold text-slate-800">{item.title}</div>
              <p className="text-xs text-slate-500">{item.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
