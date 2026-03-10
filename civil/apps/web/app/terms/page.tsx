import Link from 'next/link'

export const metadata = {
  title: 'Terms & Conditions | Civil Citizens',
}

type TermsPageProps = {
  searchParams?: {
    mode?: string
  }
}

export default function TermsPage({ searchParams }: TermsPageProps) {
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
            <h1 className="text-3xl font-bold text-slate-900">Terms &amp; Conditions</h1>
            <p className="text-sm text-slate-500">Last updated: {today}</p>
          </header>

          <section className="space-y-4 text-slate-700">
            <p>
              These Terms &amp; Conditions govern your use of Civil Citizens, including our websites, apps, and related
              services. By creating an account or using the platform, you agree to these terms.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Eligibility and Accounts</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>You must provide accurate registration information and keep it current.</li>
              <li>You are responsible for activity under your account and for safeguarding your credentials.</li>
              <li>Where required, account use is limited to users meeting local age and legal requirements.</li>
            </ul>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Acceptable Use</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Do not upload unlawful, fraudulent, abusive, or infringing content.</li>
              <li>Do not attempt to interfere with platform security, availability, or integrity.</li>
              <li>Do not impersonate others or misrepresent identity, affiliation, or authority.</li>
            </ul>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">User Content</h2>
            <p>
              You retain ownership of content you post, but grant Civil Citizens a license to host, display, process,
              and distribute that content as necessary to operate the service.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Commerce and Paid Services</h2>
            <p>
              Certain features may involve payments, subscriptions, contracts, or other transactions. Additional terms,
              fees, and policies may apply to those services.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Account Deletion</h2>
            <p>
              You may request deletion of your account from your account settings. To reduce accidental or fraudulent
              deletion requests, we currently require a two-step confirmation: first, you must type your full name, or
              the email address on the account if no full name is set, and second, you must type <span className="font-semibold text-slate-900">YES</span>.
            </p>
            <p>When an account deletion request is confirmed, Civil Citizens currently deletes the account and removes associated data, including:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Your profile record and access to the account.</li>
              <li>Your authored posts, comments, reactions, votes, poll votes, notifications, and feed-related records.</li>
              <li>Your direct-message participation, sent messages, and related call records that depend on your account.</li>
              <li>Your friendships, network connections, community follows, business follows, memberships, and push subscriptions.</li>
              <li>Organizations or business entities you own, along with posts and related records attached to those owned entities.</li>
            </ul>
            <p>
              Where deletion causes a direct-message thread to become empty or no longer valid, the remaining stale thread may also be removed. After
              deletion is completed, the account cannot be recovered through the normal product flow.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Moderation and Enforcement</h2>
            <p>
              We may review, remove, restrict, or disable content and accounts that violate these terms, applicable law,
              or platform policy, with or without prior notice where permitted by law.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Disclaimers</h2>
            <p>
              The platform is provided on an "as is" and "as available" basis to the fullest extent permitted by law.
              We do not guarantee uninterrupted or error-free service.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Civil Citizens is not liable for indirect, incidental, special, or
              consequential damages arising from use of the platform.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Termination</h2>
            <p>
              You may stop using the platform at any time. We may suspend or terminate access where terms are violated,
              required by law, or needed to protect platform integrity. If you use the in-product delete-account flow,
              the Account Deletion section above describes what happens to your account and related data.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Changes to Terms</h2>
            <p>
              We may update these terms periodically. Continued use after updates means you accept the revised terms.
            </p>
          </section>

          <section className="space-y-3 text-slate-700">
            <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
            <p>
              Questions about these terms can be sent to <a className="underline" href="mailto:support@civilcitizens.ca">support@civilcitizens.ca</a>.
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}
