'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { CanadianAddressEditor } from '../../_components/address/CanadianAddressEditor'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import {
  createEmptyCanadianAddress,
  normalizeCanadianAddress,
  type CanadianAddress,
  type SavedShippingAddress,
  writeStoredMarketShippingAddress,
} from '../../_lib/canadianAddresses'
import { redirectToAuthModal } from '../../_lib/authModal'

type ShippingAddressListResponse = {
  items?: SavedShippingAddress[]
  item?: SavedShippingAddress | null
  error?: unknown
}

function getToken() {
  return typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
}

function friendlyApiError(payload: unknown, fallback: string) {
  if (typeof payload === 'string' && payload.trim()) return payload
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.error === 'string' && record.error.trim()) return record.error
  }
  return fallback
}

export default function MarketShippingAddressEditorPageClient({ addressId }: { addressId?: string | null }) {
  const router = useRouter()
  const isEditing = Boolean(addressId)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [items, setItems] = useState<SavedShippingAddress[]>([])
  const [value, setValue] = useState<CanadianAddress>(createEmptyCanadianAddress())
  const [isDefault, setIsDefault] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const { json } = await parseApiResponse<ShippingAddressListResponse>(response)
        if (cancelled) return
        if (!response.ok) {
          pushToast('Unable to load shipping addresses right now.', 'error')
          return
        }
        const nextItems = Array.isArray(json?.items) ? json.items : []
        setItems(nextItems)

        if (addressId) {
          const current = nextItems.find((entry) => entry.id === addressId)
          if (current) {
            setValue(normalizeCanadianAddress(current))
            setIsDefault(Boolean(current.isDefault))
          } else {
            pushToast('That shipping address was not found.', 'error')
            router.replace('/market/account')
            return
          }
        } else {
          setValue(createEmptyCanadianAddress())
          setIsDefault(nextItems.length === 0)
        }
      } catch {
        if (cancelled) return
        pushToast('Unable to load shipping addresses right now.', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [addressId, router])

  const title = useMemo(() => (isEditing ? 'Edit shipping address' : 'Add shipping address'), [isEditing])

  async function saveAddress() {
    const token = getToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    const normalized = normalizeCanadianAddress(value)
    if (!normalized.name || !normalized.line1 || !normalized.city || !normalized.province || !normalized.postalCode) {
      pushToast('Recipient, street, city, province, and postal code are required.', 'error')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(buildApiUrl('/market/account/shipping-addresses'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: addressId ?? undefined,
          label: normalized.label || null,
          name: normalized.name,
          line1: normalized.line1,
          line2: normalized.line2 || null,
          city: normalized.city,
          province: normalized.province,
          postalCode: normalized.postalCode,
          country: normalized.country || 'CA',
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          isDefault,
        }),
      })
      const { json } = await parseApiResponse<ShippingAddressListResponse>(response)
      if (!response.ok) {
        pushToast(friendlyApiError(json, 'Unable to save this shipping address.'), 'error')
        return
      }

      const saved = json?.item ?? null
      if (saved?.isDefault) writeStoredMarketShippingAddress(saved)
      pushToast(isEditing ? 'Shipping address updated.' : 'Shipping address saved.', 'success')
      router.push('/market/account')
      router.refresh()
    } catch {
      pushToast('Unable to save this shipping address.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAddress() {
    if (!addressId) return
    const token = getToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setDeleting(true)
    try {
      const response = await fetch(buildApiUrl(`/market/account/shipping-addresses/${encodeURIComponent(addressId)}`), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      const { json } = await parseApiResponse<ShippingAddressListResponse>(response)
      if (!response.ok) {
        pushToast(friendlyApiError(json, 'Unable to delete this shipping address.'), 'error')
        return
      }
      pushToast('Shipping address deleted.', 'success')
      router.push('/market/account')
      router.refresh()
    } catch {
      pushToast('Unable to delete this shipping address.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DashboardShell className="bg-slate-50" mainClassName="space-y-6 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Market · Buyer Account</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">Save a Canadian shipping address with an optional nickname and default setting.</p>
          </div>
          <Link
            href="/market/account"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
          >
            Back to account
          </Link>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading address editor…</div>
          ) : (
            <div className="space-y-5">
              <CanadianAddressEditor
                value={value}
                onChange={setValue}
                disabled={saving || deleting}
                mode="shipping"
                isDefault={isDefault}
                onDefaultChange={setIsDefault}
                required
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={saveAddress}
                  disabled={saving || deleting}
                  className="inline-flex items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : isEditing ? 'Save address' : 'Add address'}
                </button>
                {addressId ? (
                  <button
                    type="button"
                    onClick={deleteAddress}
                    disabled={saving || deleting}
                    className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                  >
                    {deleting ? 'Deleting…' : 'Delete address'}
                  </button>
                ) : null}
                {items.length ? <p className="text-xs text-slate-500">Saved addresses on file: {items.length}</p> : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </DashboardShell>
  )
}