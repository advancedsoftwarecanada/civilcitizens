'use client'

import Link from 'next/link'
import { HiOutlineExclamationTriangle } from 'react-icons/hi2'
import { restoreParentAuthSession } from '../_lib/authSession'
import { clearFamilyView } from '../_lib/familyView'

export default function SuspendedPageClient() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff7ed_0%,#fff 40%,#f8fafc_100%)] px-6 py-16">
      <div className="mx-auto flex max-w-2xl flex-col items-center rounded-3xl border border-amber-200 bg-white/95 px-8 py-12 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <HiOutlineExclamationTriangle className="h-10 w-10" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold text-slate-950">Account Suspended</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
          Your account has been suspended by Family Mode, please ask your parent or guardian to restore your account.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              const restored = restoreParentAuthSession()
              if (!restored) clearFamilyView()
            }}
            className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
          >
            Exit locked device
          </button>
          <Link
            href="/settings/family"
            className="inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
          >
            Back to Family Mode
          </Link>
        </div>
      </div>
    </main>
  )
}