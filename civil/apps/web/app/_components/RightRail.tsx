import Link from 'next/link'

export function RightRail() {
  return (
    <div className="sticky top-0 space-y-4">
      <section className="border border-gray-200 bg-white p-4">
        <div className="border-b pb-3 text-sm font-semibold">For you</div>
        <p className="pt-3 text-sm text-gray-500">
          We&apos;ll recommend chambers and citizens to follow as this feed comes to life.
        </p>
      </section>

      <section className="border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Explore Canada</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-600">
          <li>
            <Link href="/chambers" className="text-[var(--cc-primary)] hover:underline">
              Browse Chambers
            </Link>
          </li>
          <li>
            <Link href="/profile" className="text-[var(--cc-primary)] hover:underline">
              Update your profile
            </Link>
          </li>
        </ul>
      </section>

      <section className="border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Coming soon</h2>
        <p className="pt-3 text-sm text-gray-500">
          This space will feature community spotlights, civic actions, and partner announcements.
        </p>
      </section>
    </div>
  )
}
