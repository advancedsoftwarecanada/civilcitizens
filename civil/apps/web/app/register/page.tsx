"use client"
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { pushToast } from '../_components/useToasts'
import { buildHandleBase } from '@civil/shared'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import { AuthScreen } from '../_components/AuthScreen'
import { setAuthToken } from '../_lib/authSession'
import AppleInstallRedirect from '../_components/AppleInstallRedirect'
import Modal from '../_components/Modal'

type FieldErrors = Record<string, string[]>

type RegisterSuccess = {
  token: string
}

type LoginSuccess = {
  token: string
}

type RegisterErrorResponse = {
  error?:
    | string
    | {
        fieldErrors?: FieldErrors
      }
  message?: string
}

type LegalDocumentKey = 'terms' | 'privacy' | 'safety'

const LEGAL_DOCUMENTS: Record<LegalDocumentKey, { title: string; href: string }> = {
  terms: { title: 'Terms of Service', href: '/terms' },
  privacy: { title: 'Privacy Policy', href: '/privacy' },
  safety: { title: 'Child Safety & Protection Standards', href: '/safety' },
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const ORG_INVITE_TOKEN_KEY = 'civil.orgInviteToken'

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKey | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const previewHandle = useMemo(() => buildHandleBase(firstName, lastName), [firstName, lastName])
  const activeLegalDocument = legalDocument ? LEGAL_DOCUMENTS[legalDocument] : null

  const hasFieldError = (key: string) => Array.isArray(fieldErrors[key]) && fieldErrors[key].length > 0
  const firstFieldError = (key: string) => fieldErrors[key]?.[0] ?? null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    setFormError(null)
    setFieldErrors({})

    const validationErrors: FieldErrors = {}

    if (!firstName.trim()) validationErrors.firstName = ['First name is required']
    if (!lastName.trim()) validationErrors.lastName = ['Last name is required']
    if (!email || !isValidEmail(email)) validationErrors.email = ['Enter a valid email']
    if (!password || password.length < 8) validationErrors.password = ['Password must be at least 8 characters']
    if (!acceptTerms) validationErrors.acceptTerms = ['You must accept the terms']

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setFormError('Please fix the errors and try again')
      return
    }

    const inviteTokenFromUrl = searchParams?.get('orgInviteToken')?.trim() || ''
    const inviteTokenFromStorage = (() => {
      if (typeof window === 'undefined') return ''
      try {
        return window.localStorage.getItem(ORG_INVITE_TOKEN_KEY)?.trim() || ''
      } catch {
        return ''
      }
    })()
    const inviteToken = inviteTokenFromUrl || inviteTokenFromStorage || ''

    const signInAndRedirect = async (registerToken?: string) => {
      if (typeof registerToken === 'string' && registerToken.length > 0) {
        setAuthToken(registerToken)
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(ORG_INVITE_TOKEN_KEY)
          } catch {}
        }
        router.replace('/welcome')
        return true
      }

      const loginResponse = await fetch(buildApiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailOrHandle: email, password }),
      })
      const { json: loginData } = await parseApiResponse<LoginSuccess>(loginResponse)
      if (!loginResponse.ok) return false

      if (loginData && typeof loginData.token === 'string' && loginData.token.length > 0) {
        setAuthToken(loginData.token)
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(ORG_INVITE_TOKEN_KEY)
          } catch {}
        }
        router.replace('/welcome')
        return true
      }

      return false
    }

    setIsSubmitting(true)
    try {
      const payload = {
        email,
        firstName,
        lastName,
        password,
        acceptTerms,
        ...(inviteToken ? { orgInviteToken: inviteToken } : {}),
      }

      const response = await fetch(buildApiUrl('/auth/register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const { json: data, text: fallbackText } = await parseApiResponse<RegisterSuccess & RegisterErrorResponse>(response)
      const safeData: Partial<RegisterSuccess & RegisterErrorResponse> = data ?? {}

      if (!response.ok) {
        const apiCode = typeof safeData.error === 'string' ? safeData.error : null
        if (apiCode === 'email_or_handle_exists') {
          const signedIn = await signInAndRedirect()
          if (signedIn) return
        }

        const fieldErrorPayload = typeof safeData.error === 'object' && safeData.error && 'fieldErrors' in safeData.error ? safeData.error.fieldErrors : null
        if (fieldErrorPayload && typeof fieldErrorPayload === 'object') {
          setFieldErrors(fieldErrorPayload as FieldErrors)
          setFormError('Please fix the errors and try again')
          return
        }

        const looksLikeHtml = typeof fallbackText === 'string' && /<[^>]+>/.test(fallbackText)
        const sanitizedFallback = looksLikeHtml ? null : fallbackText?.trim()
        const statusFallback = response.status >= 500 ? `Service temporarily unavailable (${response.status}). Please try again.` : null
        const message =
          (typeof safeData.error === 'string' && safeData.error) ||
          (typeof safeData.message === 'string' && safeData.message) ||
          sanitizedFallback ||
          statusFallback ||
          'Registration failed'
        setFormError(message)
        pushToast(message, 'error')
        return
      }

      const signedIn = await signInAndRedirect(safeData.token)
      if (!signedIn) {
        const message = 'Account created, but automatic sign-in failed. Please sign in.'
        setFormError(message)
        pushToast(message, 'error')
      }
    } catch (error) {
      console.error('Registration request failed', error)
      pushToast('Unexpected error during registration. Please try again.', 'error')
      setFormError('Unexpected error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass = (key: string) =>
    `w-full rounded-2xl border px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 transition focus-visible:outline-none ${
      hasFieldError(key)
        ? 'border-red-500 ring-2 ring-red-100'
        : 'border-slate-200 focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15'
    }`

  const footer = (
    <div className="space-y-2">
      <p>
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-[var(--cc-primary)]">
          Sign in
        </Link>
      </p>
      <p>
        Forgot password?{' '}
        <Link href="/forgot" className="font-semibold text-[var(--cc-primary)]">
          Reset it here
        </Link>
      </p>
    </div>
  )

  return (
    <>
      <AppleInstallRedirect source="register" />
      <AuthScreen
        title="Create your Civil account"
        subtitle="Reserve your handle, pick your home city, and get access to Canada’s civic operating system."
        footer={footer}
        hideSidePanel
        useWallpaper
      >
        <form onSubmit={handleSubmit} className="space-y-5" autoCapitalize="none" autoCorrect="off" spellCheck={false}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              First name
              <input className={`${inputClass('firstName')} mt-2`} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              {hasFieldError('firstName') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('firstName')}</div> : null}
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Last name
              <input className={`${inputClass('lastName')} mt-2`} value={lastName} onChange={(event) => setLastName(event.target.value)} />
              {hasFieldError('lastName') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('lastName')}</div> : null}
            </label>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Your Civil handle will be <span className="font-semibold text-slate-900">@{previewHandle}</span>. If it&apos;s taken, we&apos;ll make a tiny tweak to keep it unique.
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input className={`${inputClass('email')} mt-2`} value={email} onChange={(event) => setEmail(event.target.value)} />
            {hasFieldError('email') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('email')}</div> : null}
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input className={`${inputClass('password')} mt-2`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            {hasFieldError('password') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('password')}</div> : null}
          </label>
          <div className="flex items-start gap-3 text-sm text-slate-600">
            <input
              id="accept-terms"
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/25"
              checked={acceptTerms}
              onChange={(event) => setAcceptTerms(event.target.checked)}
            />
            <div className="leading-6">
              <label htmlFor="accept-terms" className="cursor-pointer">
                I agree to the{' '}
              </label>
              <button type="button" className="underline underline-offset-2" onClick={() => setLegalDocument('terms')}>
                Terms of Service
              </button>{' '}
              and{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => setLegalDocument('privacy')}>
                Privacy Policy
              </button>{' '}
              and{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => setLegalDocument('safety')}>
                Child Safety &amp; Protection Standards
              </button>
            </div>
          </div>
          {hasFieldError('acceptTerms') ? <div className="mt-1 text-xs text-red-600">⚠️ {firstFieldError('acceptTerms')}</div> : null}
          {formError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
          <button className="w-full rounded-2xl bg-[var(--cc-primary)] px-4 py-3 text-base font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <Modal
          open={Boolean(activeLegalDocument)}
          onClose={() => setLegalDocument(null)}
          title={activeLegalDocument?.title}
          maxWidthClassName="max-w-5xl"
        >
          {activeLegalDocument ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Review this document without leaving registration. Your form entries stay in place.
              </p>
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <iframe
                  src={`${activeLegalDocument.href}?mode=modal`}
                  title={activeLegalDocument.title}
                  className="h-[70vh] w-full bg-white"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setLegalDocument(null)}
                  className="rounded-2xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
                >
                  Back to registration
                </button>
              </div>
            </div>
          ) : null}
        </Modal>
      </AuthScreen>
    </>
  )
}
