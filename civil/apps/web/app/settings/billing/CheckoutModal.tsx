"use client"

import { FormEvent, useCallback, useMemo, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import type { MeResponse } from '../../_lib/me'

export type CheckoutSessionConfig = {
  mode: 'premium' | 'business'
  business?: { id: string; name: string } | null
  publishableKey: string
  clientSecret: string
}

type BillingProfile = {
  firstName: string
  lastName: string
  companyName: string
  email: string
  phone: string
  country: string
  state: string
  city: string
  address1: string
  address2: string
  postalCode: string
}

type CheckoutModalProps = {
  session: CheckoutSessionConfig
  token: string
  me: MeResponse | null
  billingProfile?: BillingProfile | null
  onClose: () => void
  onComplete: () => Promise<void> | void
}

type CheckoutResponse = {
  subscriptionId?: string | null
  invoiceId?: string | null
  paymentIntentId?: string | null
  paymentIntentStatus?: string | null
  requiresAction?: boolean
  clientSecret?: string | null
  planApplied?: boolean
  error?: unknown
}

export function CheckoutModal(props: CheckoutModalProps) {
  const { session } = props
  const stripePromise = useMemo(() => loadStripe(session.publishableKey), [session.publishableKey])

  if (!stripePromise || !session.clientSecret) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="w-full max-w-lg">
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: session.clientSecret,
            appearance: {
              theme: 'stripe',
              variables: { colorPrimary: '#C8102E' },
            },
          }}
        >
          <CheckoutForm {...props} />
        </Elements>
      </div>
    </div>
  )
}

function buildBillingDetails(profile?: BillingProfile | null, fallback?: { name?: string | null; email?: string | null }) {
  if (!profile) {
    return {
      name: fallback?.name ?? undefined,
      email: fallback?.email ?? undefined,
    }
  }
  const composedName = `${profile.firstName} ${profile.lastName}`.trim() || profile.companyName || fallback?.name || undefined
  const hasAddress = profile.address1 || profile.address2 || profile.city || profile.state || profile.postalCode || profile.country
  return {
    name: composedName || undefined,
    email: profile.email || fallback?.email || undefined,
    phone: profile.phone || undefined,
    address: hasAddress
      ? {
          line1: profile.address1 || undefined,
          line2: profile.address2 || undefined,
          city: profile.city || undefined,
          state: profile.state || undefined,
          postal_code: profile.postalCode || undefined,
          country: profile.country || undefined,
        }
      : undefined,
  }
}

function CheckoutForm({ session, token, me, billingProfile, onClose, onComplete }: CheckoutModalProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepMessage, setStepMessage] = useState<string | null>(null)
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<string | null>(null)
  const fallbackDetails = useMemo(() => ({ name: me?.name ?? null, email: me?.email ?? null }), [me])
  const billingDetails = useMemo(() => buildBillingDetails(billingProfile, fallbackDetails), [billingProfile, fallbackDetails])

  // TODO: If/when we re-surface premium upsell copy, revisit these strings.
  const title = session.mode === 'premium' ? 'Premium membership' : `Activate ${session.business?.name ?? 'Business'}`
  const description =
    session.mode === 'premium'
      ? 'Activate premium billing without leaving Civil Citizens.'
      : 'Add billing for this organization directly inside Civil Citizens.'
  const endpoint = session.mode === 'premium' ? '/billing/premium/checkout' : session.business ? `/businesses/${session.business.id}/checkout` : null

  const closeDisabled = submitting

  const handleSuccess = useCallback(
    async (message: string) => {
      pushToast(message, 'success', 6000)
      await onComplete()
      onClose()
    },
    [onClose, onComplete],
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!endpoint) {
        setError('Checkout endpoint unavailable.')
        return
      }
      if (!stripe || !elements) {
        setError('Payment form is still loading. Please wait a moment and try again.')
        return
      }

      setSubmitting(true)
      setError(null)
      setStepMessage('Saving your payment method…')

      const { error: submitError } = await elements.submit()
      if (submitError) {
        setError(submitError.message ?? 'Unable to validate payment details. Check the form and try again.')
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      const { setupIntent, error: confirmError } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: typeof window !== 'undefined' ? `${window.location.origin}/settings/billing?checkout=complete` : undefined,
          payment_method_data: {
              billing_details: billingDetails,
          },
        },
      })

      const resolvedSetupIntent =
        setupIntent ?? (confirmError as { setup_intent?: { id: string; status?: string; payment_method?: string | { id?: string } } } | undefined)?.setup_intent ?? null

      if (confirmError && (!resolvedSetupIntent || resolvedSetupIntent.status !== 'succeeded')) {
        setError(confirmError.message ?? 'Stripe could not save that payment method. Try another card.')
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      if (!resolvedSetupIntent) {
        setError('Stripe did not return a setup intent. Please try again.')
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      const paymentMethodId =
        typeof resolvedSetupIntent.payment_method === 'string'
          ? resolvedSetupIntent.payment_method
          : resolvedSetupIntent.payment_method?.id ?? null

      if (!paymentMethodId) {
        setError('Stripe did not return a payment method. Please try again.')
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      setStepMessage('Creating your subscription…')

      const payload: Record<string, unknown> = {
        paymentMethodId,
        setupIntentId: resolvedSetupIntent.id,
      }

      const response = await fetch(buildApiUrl(endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      const body = (await response.json().catch(() => null)) as CheckoutResponse | null
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Unable to create the subscription. Please try again later.')
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      setActiveSubscriptionId(body?.subscriptionId ?? null)

      if (body?.planApplied) {
        const successMessage =
          session.mode === 'premium'
            ? 'Premium membership activated.'
            : `${session.business?.name ?? 'Business'} subscription activated.`
        await handleSuccess(successMessage)
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      if (body?.requiresAction && body.clientSecret && body.subscriptionId) {
        setStepMessage('Confirming your card…')
        const { error: actionError } = await stripe.confirmCardPayment(body.clientSecret)
        if (actionError) {
          setError(actionError.message ?? 'Additional card confirmation failed. Please try again.')
          setSubmitting(false)
          setStepMessage(null)
          return
        }

        setStepMessage('Finalizing subscription…')
        const finalizeResponse = await fetch(buildApiUrl(endpoint), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ subscriptionId: body.subscriptionId }),
        })
        const finalizeBody = (await finalizeResponse.json().catch(() => null)) as CheckoutResponse | null
        if (!finalizeResponse.ok) {
          setError(typeof finalizeBody?.error === 'string' ? finalizeBody.error : 'Unable to finalize the subscription.')
          setSubmitting(false)
          setStepMessage(null)
          return
        }

        if (finalizeBody?.planApplied) {
          const successMessage =
            session.mode === 'premium'
              ? 'Premium membership activated.'
              : `${session.business?.name ?? 'Business'} subscription activated.`
          await handleSuccess(successMessage)
          setSubmitting(false)
          setStepMessage(null)
          return
        }

        setError('Subscription still requires attention. Check your card and try again.')
        setSubmitting(false)
        setStepMessage(null)
        return
      }

      setError('Stripe returned an unexpected response. Please try again.')
      setSubmitting(false)
      setStepMessage(null)
    },
    [endpoint, stripe, elements, me, token, handleSuccess, session.mode, session.business?.name],
  )

  return (
    <form className="rounded-3xl bg-white p-6 shadow-2xl" onSubmit={handleSubmit}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-slate-900">{title}</p>
          <p className="text-sm text-slate-500">{description}</p>
          {activeSubscriptionId ? (
            <p className="mt-2 text-xs text-slate-400">Subscription ID: {activeSubscriptionId}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-40"
          aria-label="Close checkout"
        >
          ✕
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <PaymentElement id="civil-payment-element" options={{ layout: 'tabs' }} />
      </div>

      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {stepMessage ? <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">{stepMessage}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-5 w-full rounded-2xl bg-[#C8102E] px-4 py-3 text-center text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-[#a30d26] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Processing…' : 'Confirm and Pay'}
      </button>
    </form>
  )
}
