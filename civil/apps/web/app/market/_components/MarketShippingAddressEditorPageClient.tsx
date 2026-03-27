'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Block from '../../_components/Block'
import DashboardShell from '../../_components/DashboardShell'
import Modal from '../../_components/Modal'
import { CanadianAddressEditor } from '../../_components/address/CanadianAddressEditor'
import { pushToast } from '../../_components/useToasts'
import {
  buildAddressSearchQueries,
  buildAddressesHref,
  buildAddressesHrefFromAddress,
  buildCanadianAddressFromSearchResult,
  resolveBestAddressSearchResult,
} from '../../_lib/addressSearch'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import {
  createEmptyCanadianAddress,
  getCanadianAddressSystemDisplayName,
  isCanadianAddressPostalVerified,
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

type FavoriteAddress = {
  id: string
  label: string
  address: string | null
  latitude: number | null
  longitude: number | null
  savedAt: string
}

const ADDRESS_FAVORITES_STORAGE_KEY = 'civil_address_favorites'

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

function readFavoriteAddresses() {
  if (typeof window === 'undefined') return [] as FavoriteAddress[]
  try {
    const raw = window.localStorage.getItem(ADDRESS_FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const record = entry as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        if (!id || !label) return null
        return {
          id,
          label,
          address: typeof record.address === 'string' ? record.address.trim() || null : null,
          latitude: typeof record.latitude === 'number' && Number.isFinite(record.latitude) ? record.latitude : null,
          longitude: typeof record.longitude === 'number' && Number.isFinite(record.longitude) ? record.longitude : null,
          savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date(0).toISOString(),
        } satisfies FavoriteAddress
      })
      .filter((entry): entry is FavoriteAddress => Boolean(entry))
  } catch {
    return []
  }
}

function isHomeAddress(address: SavedShippingAddress) {
  const label = `${address.label ?? ''} ${address.name ?? ''}`.trim().toLowerCase()
  return address.isDefault || label.includes('home')
}

function formatSavedAddressTitle(address: SavedShippingAddress, fallback: string) {
  return address.label?.trim() || address.name?.trim() || fallback
}

function formatSavedAddressDetail(address: SavedShippingAddress, options?: { includeName?: boolean }) {
  const includeName = options?.includeName ?? true
  const lines = [includeName ? address.name?.trim() : '', address.line1?.trim(), address.line2?.trim()].filter(Boolean)
  const locality = [
    address.city?.trim(),
    address.province?.trim(),
    isCanadianAddressPostalVerified(address) ? address.postalCode?.trim() : '',
  ]
    .filter(Boolean)
    .join(', ')
  if (locality) lines.push(locality)
  return lines.join(', ')
}

function formatHomeAddressTitle(address: SavedShippingAddress) {
  const nickname = address.name?.trim()
  return nickname ? `Home, ${nickname}` : 'Home'
}

function AddressEditorRightRail({
  homeAddress,
  nextAddress,
  favoriteAddresses,
  manageHref,
}: {
  homeAddress: SavedShippingAddress | null
  nextAddress: SavedShippingAddress | null
  favoriteAddresses: FavoriteAddress[]
  manageHref: string
}) {
  return (
    <>
      <Block title="My Addresses" action={{ label: 'Manage', href: manageHref }} className="mb-4">
        <div className="space-y-3">
          {homeAddress ? (
            <Link
              href={buildAddressesHrefFromAddress(homeAddress, 'Home')}
              className="block rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 transition hover:border-emerald-300 hover:bg-emerald-100/70"
            >
              <p className="text-sm font-semibold text-emerald-900">{formatHomeAddressTitle(homeAddress)}</p>
              <p className="mt-1 text-xs text-emerald-800">{formatSavedAddressDetail(homeAddress, { includeName: false })}</p>
            </Link>
          ) : null}
          {nextAddress ? (
            <Link
              href={buildAddressesHrefFromAddress(nextAddress, nextAddress.label?.trim() || nextAddress.name?.trim() || 'Next address')}
              className="block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-white"
            >
              <p className="text-sm font-semibold text-slate-900">{formatSavedAddressTitle(nextAddress, 'Next Address')}</p>
              <p className="mt-1 text-xs text-slate-500">{formatSavedAddressDetail(nextAddress)}</p>
            </Link>
          ) : null}
          {!homeAddress && !nextAddress ? <p className="text-sm text-slate-500">No saved addresses yet.</p> : null}
        </div>
      </Block>

      <Block title="My Favorites">
        <div className="space-y-3">
          {favoriteAddresses.length ? (
            favoriteAddresses.map((favorite) => (
              <Link
                key={favorite.id}
                href={buildAddressesHref({
                  query: favorite.address || favorite.label,
                  label: favorite.label,
                  address: favorite.address,
                  latitude: favorite.latitude,
                  longitude: favorite.longitude,
                })}
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-[var(--cc-primary)]/30 hover:bg-white"
              >
                <p className="text-sm font-semibold text-slate-900">{favorite.label}</p>
                {favorite.address ? <p className="mt-1 text-xs text-slate-500">{favorite.address}</p> : null}
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">No favorite addresses saved yet.</p>
          )}
        </div>
      </Block>
    </>
  )
}

export default function MarketShippingAddressEditorPageClient({
  addressId,
  context = 'settings',
}: {
  addressId?: string | null
  context?: 'market' | 'settings'
}) {
  const router = useRouter()
  const isEditing = Boolean(addressId)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [addressSearchQuery, setAddressSearchQuery] = useState('')
  const [items, setItems] = useState<SavedShippingAddress[]>([])
  const [favoriteAddresses, setFavoriteAddresses] = useState<FavoriteAddress[]>([])
  const [value, setValue] = useState<CanadianAddress>(createEmptyCanadianAddress())
  const [isDefault, setIsDefault] = useState(false)

  const returnHref = context === 'market' ? '/market/account' : '/settings/addresses'
  const eyebrow = context === 'market' ? 'Market · Buyer Account' : 'Settings'
  const title = useMemo(() => (isEditing ? 'Edit address' : 'Add address'), [isEditing])
  const saveButtonLabel = useMemo(() => (isEditing ? 'Save address' : 'Add address'), [isEditing])

  useEffect(() => {
    setFavoriteAddresses(readFavoriteAddresses())
  }, [])

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
            router.replace(returnHref)
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
  }, [addressId, returnHref, router])

  const orderedSavedAddresses = useMemo(
    () => [...items].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || String(left.label ?? '').localeCompare(String(right.label ?? ''))),
    [items],
  )
  const homeAddress = useMemo(() => orderedSavedAddresses.find((address) => isHomeAddress(address)) ?? null, [orderedSavedAddresses])
  const nextAddress = useMemo(
    () => orderedSavedAddresses.find((address) => !homeAddress || address.id !== homeAddress.id) ?? null,
    [homeAddress, orderedSavedAddresses],
  )
  const rightRail = useMemo(
    () => <AddressEditorRightRail homeAddress={homeAddress} nextAddress={nextAddress} favoriteAddresses={favoriteAddresses} manageHref={returnHref} />,
    [favoriteAddresses, homeAddress, nextAddress, returnHref],
  )

  async function saveAddress() {
    const token = getToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    let normalized = normalizeCanadianAddress(value)
    const candidateQueries = [
      getCanadianAddressSystemDisplayName(normalized) || '',
      addressSearchQuery.trim(),
      ...buildAddressSearchQueries(normalized),
    ].filter((query, index, values) => {
      const trimmed = query.trim()
      if (trimmed.length < 3) return false
      return values.findIndex((value) => value.trim().toLowerCase() === trimmed.toLowerCase()) === index
    })

    if ((!normalized.line1 || !normalized.city || !normalized.province) && candidateQueries.length) {
      try {
        for (const candidateQuery of candidateQueries) {
          const resolved = await resolveBestAddressSearchResult(candidateQuery, undefined, 1)
          if (!resolved) continue

          normalized = buildCanadianAddressFromSearchResult(resolved, normalized)
          setValue(normalized)
          break
        }
      } catch {
      }
    }

    if (!normalized.line1 || !normalized.city || !normalized.province || !normalized.postalCode) {
      pushToast('Street, city, province, and postal code are required.', 'error')
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
          name: normalized.name || null,
          line1: normalized.line1,
          line2: normalized.line2 || null,
          city: normalized.city,
          province: normalized.province,
          postalCode: normalized.postalCode,
          originalPostalCode: normalized.originalPostalCode || null,
          country: normalized.country || 'CA',
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          nominatimDisplayName: normalized.nominatimDisplayName || null,
          nominatimRaw: normalized.nominatimRaw ?? null,
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
      pushToast(isEditing ? 'Address updated.' : 'Address saved.', 'success')
      router.push(returnHref)
      router.refresh()
    } catch {
      pushToast('Unable to save this address.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAddress() {
    if (!addressId) return false
    const token = getToken()
    if (!token) {
      redirectToAuthModal('login')
      return false
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
        return false
      }
      pushToast('Address deleted.', 'success')
      router.push(returnHref)
      router.refresh()
      return true
    } catch {
      pushToast('Unable to delete this address.', 'error')
      return false
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DashboardShell className="bg-slate-50" mainClassName="space-y-6 pb-12" rightRail={rightRail}>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{eyebrow}</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={saveAddress}
              disabled={loading || saving || deleting}
              className="inline-flex items-center justify-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : saveButtonLabel}
            </button>
            {addressId ? (
              <button
                type="button"
                onClick={() => setDeleteModalOpen(true)}
                disabled={loading || saving || deleting}
                className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete address'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading address editor…</div>
          ) : (
            <div className="space-y-5">
              <CanadianAddressEditor
                value={value}
                onChange={setValue}
                onSearchQueryChange={setAddressSearchQuery}
                disabled={saving || deleting}
                mode="shipping"
                isDefault={isDefault}
                onDefaultChange={setIsDefault}
                required
              />

              {items.length ? <p className="text-xs text-slate-500">Saved addresses on file: {items.length}</p> : null}
            </div>
          )}
        </div>
      </section>

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete address" maxWidthClassName="max-w-lg">
        <div className="space-y-5">
          <p className="text-sm leading-6 text-slate-700">Delete this shipping address from your account?</p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteModalOpen(false)}
              disabled={deleting}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void deleteAddress().then((deleted) => {
                  if (deleted) setDeleteModalOpen(false)
                })
              }}
              disabled={deleting}
              className="inline-flex items-center justify-center rounded-full border border-rose-600 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete address'}
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}
