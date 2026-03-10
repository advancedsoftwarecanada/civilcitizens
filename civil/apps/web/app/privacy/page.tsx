import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | Civil Citizens',
}

type PrivacyPageProps = {
  searchParams?: {
    mode?: string
  }
}

export default function PrivacyPage({ searchParams }: PrivacyPageProps) {
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
            <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-500">Last updated: {today}</p>
          </header>

          <section className="space-y-4 text-slate-700">
            <p>
              This Privacy Policy explains how Civil Citizens collects, uses, stores, and protects personal information
              when you use our platform, websites, and related services.
            </p>
            <p>
              By accessing or using Civil Citizens, you agree to this Privacy Policy and our Terms &amp; Conditions.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Information We Collect</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Account information such as name, handle, email, and profile details.</li>
              <li>Content and activity, including posts, messages, reactions, uploads, and interactions.</li>
              <li>Device and technical information such as IP address, browser type, and usage analytics.</li>
              <li>Transaction and billing information where paid services are used.</li>
            </ul>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">How We Use Information</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Operate, maintain, and improve the platform.</li>
              <li>Authenticate users, secure accounts, and prevent fraud or abuse.</li>
              <li>Provide support and communicate service updates.</li>
              <li>Comply with legal obligations and enforce platform policies.</li>
            </ul>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Sharing and Disclosure</h2>
            <p>
              We do not sell your personal information. We may share information with trusted processors and service
              providers who support platform operations, or when required by law, court order, or regulatory obligation.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Data Retention</h2>
            <p>
              We retain information for as long as reasonably necessary to provide services, support operations, resolve
              disputes, enforce agreements, and comply with legal requirements.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Your Choices and Rights</h2>
            <p>
              Subject to applicable law, you may have rights to access, correct, or delete your personal information.
              Requests can be sent to <a className="underline" href="mailto:support@civilcitizens.ca">support@civilcitizens.ca</a>.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Security</h2>
            <p>
              We use administrative, technical, and organizational safeguards designed to protect personal information.
              No platform is perfectly secure, and users remain responsible for protecting their login credentials.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Children and Family Accounts</h2>
            <p>
              Where family-account features are provided, parent or guardian controls are designed to support oversight.
              Users must comply with age and eligibility requirements in applicable jurisdictions.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Continued use of the platform after updates means the
              revised policy applies.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
            <p>
              For privacy inquiries, contact <a className="underline" href="mailto:support@civilcitizens.ca">support@civilcitizens.ca</a>.
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}
