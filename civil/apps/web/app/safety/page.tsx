import Link from 'next/link'

export const metadata = {
  title: 'Child Safety and Protection Standards | Civil Citizens',
}

type SafetyPageProps = {
  searchParams?: {
    mode?: string
  }
}

export default function SafetyPage({ searchParams }: SafetyPageProps) {
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
            <h1 className="text-3xl font-bold text-slate-900">Civil Child Safety and Protection Standards</h1>
            <p className="text-sm text-slate-500">Last updated: {today}</p>
          </header>

          <section className="space-y-4 text-slate-700">
            <p>
              Civil Citizens maintains a strict zero tolerance policy toward child sexual abuse and exploitation (CSAE)
              and child sexual abuse material (CSAM). Protecting children and families is a foundational principle of
              the Civil platform.
            </p>
            <p>
              Civil prohibits any content, communication, or activity that exploits, harms, or endangers minors.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Prohibited Conduct</h2>
            <p>This includes but is not limited to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Child sexual abuse material (CSAM).</li>
              <li>Grooming or predatory behavior toward minors.</li>
              <li>Sexualization of minors.</li>
              <li>Solicitation involving minors.</li>
              <li>Exploitation, trafficking, or coercion involving children.</li>
            </ul>
            <p>Any account involved in such activities will be permanently removed from the platform.</p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Proactive Safety Measures</h2>
            <p>Civil implements multiple layers of protection to prevent abuse and protect minors.</p>
            <p>These safeguards include:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>AI assisted content moderation to detect harmful or illegal content.</li>
              <li>User reporting tools available across posts, comments, profiles, organizations, and marketplace listings.</li>
              <li>Immediate quarantine of reported content while under review.</li>
              <li>Account suspension and permanent bans for violations.</li>
              <li>Human moderation review for safety reports.</li>
              <li>Cooperation with law enforcement and relevant authorities where required by law.</li>
            </ul>
            <p>Civil complies with all applicable child protection and reporting laws.</p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Civil for Families</h2>
            <p>
              Civil is developing a dedicated experience called Civil for Families, designed to ensure a safe
              environment for younger users.
            </p>
            <p>Family safety features include:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Family safe browsing environments.</li>
              <li>Restricted content filters for minors.</li>
              <li>Parent or guardian supervised accounts.</li>
              <li>Age appropriate community participation.</li>
              <li>Strong protections against harassment and exploitation.</li>
            </ul>
            <p>
              These protections are intended to create a safe digital environment where families and children can
              participate in civic and community life without exposure to harmful content.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Reporting Child Safety Concerns</h2>
            <p>
              Civil provides in app tools that allow users to report any content, behavior, or account suspected of
              violating child safety standards.
            </p>
            <p>
              To learn more about reporting requirements, visit the{' '}
              <Link href="/help#child-safety-reporting" className="underline">
                Help Center
              </Link>
              .
            </p>
            <p>
              Reports are reviewed by moderators and may result in immediate content removal, account suspension, or
              escalation to authorities where appropriate.
            </p>
            <p>Users are encouraged to report any activity that may threaten the safety of a minor.</p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Cooperation With Authorities</h2>
            <p>
              Civil Citizens cooperates with regional and national law enforcement agencies when investigating illegal
              activities involving child exploitation or abuse.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Compliance</h2>
            <p>Civil complies with all applicable child protection laws and reporting requirements.</p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
            <p>
              For child safety concerns, legal inquiries, or reports related to CSAE or CSAM, please contact{' '}
              <a className="underline" href="mailto:civilcitizensincorporated@gmail.com">
                civilcitizensincorporated@gmail.com
              </a>
              .
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}