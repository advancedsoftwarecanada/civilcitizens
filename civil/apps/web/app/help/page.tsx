import Link from 'next/link'

export const metadata = {
  title: 'Help Center | Civil Citizens',
}

type HelpCenterPageProps = {
  searchParams?: {
    mode?: string
  }
}

export default function HelpCenterPage({ searchParams }: HelpCenterPageProps) {
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const isModal = searchParams?.mode === 'modal'

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {isModal ? null : (
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Return home
          </Link>
        )}

        <article className="surface-card space-y-6 p-6 sm:p-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-900">Help Center</h1>
            <p className="text-sm text-slate-500">Last updated: {today}</p>
          </header>

          <section id="child-safety-reporting" className="space-y-4 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Reporting Child Safety Concerns</h2>
            <p>
              Civil Citizens allows users to report child safety concerns in-app. To learn more about reporting
              requirements, visit the Help Center.
            </p>
            <p>
              If you encounter content, behavior, communications, or accounts that may threaten the safety of a minor,
              use Civil&apos;s in-app reporting tools immediately.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">How to Report In-App</h2>
            <ol className="list-decimal space-y-2 pl-6">
              <li>Open the report or settings menu on the exact content, profile, organization, or listing.</li>
              <li>Select every reason that applies, including <span className="font-semibold text-slate-900">Child safety</span> when relevant.</li>
              <li>Add any details that will help moderators review the report faster.</li>
              <li>Submit the report so Civil can quarantine the reported content for review.</li>
            </ol>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Where Reporting Tools Are Available</h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>Posts</li>
              <li>Comments</li>
              <li>Profiles</li>
              <li>Organizations</li>
              <li>Marketplace listings and products</li>
            </ul>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">What Happens After a Report</h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>Reported content may be immediately restricted or quarantined from public view.</li>
              <li>Safety reports are reviewed by moderators.</li>
              <li>Violating accounts may be suspended or permanently banned.</li>
              <li>Illegal activity may be escalated to law enforcement or relevant authorities where appropriate.</li>
            </ul>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Related Standards</h2>
            <p>
              For Civil&apos;s child safety policy, visit{' '}
              <Link href="/safety" className="underline">
                Child Safety &amp; Protection Standards
              </Link>
              .
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}