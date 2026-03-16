'use client'

import type { ElectoralDistrictContextResponse } from '@civil/shared'
import { useEffect, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import {
  CANADIAN_PROVINCE_OPTIONS,
  createEmptyCanadianAddress,
  hasCanadianAddressValue,
  normalizeCanadianAddress,
  normalizeCanadianPostalCode,
  normalizeCanadianProvince,
  type CanadianAddress,
} from '../../_lib/canadianAddresses'
import { CivilDistrictMap } from '../map/CivilDistrictMap'

type CanadianAddressEditorProps = {
  value: CanadianAddress | null | undefined
  onChange: (next: CanadianAddress) => void
  disabled?: boolean
  mode?: 'shipping' | 'organization'
  isDefault?: boolean
  onDefaultChange?: (next: boolean) => void
  required?: boolean
}

function readToken() {
  return typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
}

export function CanadianAddressEditor({
  value,
  onChange,
  disabled = false,
  mode = 'organization',
  isDefault = false,
  onDefaultChange,
  required = false,
}: CanadianAddressEditorProps) {
  const displayValue: CanadianAddress = {
    ...createEmptyCanadianAddress(),
    ...(value && typeof value === 'object' ? value : {}),
  }
  const normalizedValue = normalizeCanadianAddress(value ?? createEmptyCanadianAddress())
  const [preview, setPreview] = useState<ElectoralDistrictContextResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    const token = readToken()
    if (!token) {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    const postalCode = normalizeCanadianPostalCode(normalizedValue.postalCode)
    const hasCoordinates = Number.isFinite(normalizedValue.latitude) && Number.isFinite(normalizedValue.longitude)
    if (!postalCode && !hasCoordinates) {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const response = await fetch(buildApiUrl('/geography/district-context'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            hasCoordinates
              ? { lat: normalizedValue.latitude, lng: normalizedValue.longitude, postalCode: postalCode || undefined }
              : { postalCode },
          ),
        })
        const { json } = await parseApiResponse<ElectoralDistrictContextResponse & { error?: unknown }>(response)
        if (cancelled) return
        if (!response.ok || !json?.userLocation) {
          setPreview(null)
          setPreviewError('Map preview unavailable for this address yet.')
          return
        }
        setPreview(json)
      } catch {
        if (cancelled) return
        setPreview(null)
        setPreviewError('Map preview unavailable for this address yet.')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [normalizedValue.latitude, normalizedValue.longitude, normalizedValue.postalCode])

  function patchAddress(patch: Partial<CanadianAddress>) {
    onChange({ ...displayValue, ...patch })
  }

  const showShippingFields = mode === 'shipping'
  const hasAnyAddress = hasCanadianAddressValue(displayValue)

  return (
    <div className="space-y-4">
      {showShippingFields ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Nickname
            <input
              value={displayValue.label ?? ''}
              onChange={(event) => patchAddress({ label: event.target.value })}
              disabled={disabled}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="Home"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Recipient name{required ? ' *' : ''}
            <input
              value={displayValue.name ?? ''}
              onChange={(event) => patchAddress({ name: event.target.value })}
              disabled={disabled}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="Full name"
            />
          </label>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
          Address line 1{required ? ' *' : ''}
          <input
            value={displayValue.line1 ?? ''}
            onChange={(event) => patchAddress({ line1: event.target.value })}
            disabled={disabled}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="Street number and street name"
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
          Address line 2
          <input
            value={displayValue.line2 ?? ''}
            onChange={(event) => patchAddress({ line2: event.target.value })}
            disabled={disabled}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="Apartment, suite, unit, building"
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          City{required ? ' *' : ''}
          <input
            value={displayValue.city ?? ''}
            onChange={(event) => patchAddress({ city: event.target.value })}
            disabled={disabled}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="Toronto"
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Province or territory{required ? ' *' : ''}
          <select
            value={normalizeCanadianProvince(normalizedValue.province)}
            onChange={(event) => patchAddress({ province: event.target.value })}
            disabled={disabled}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
          >
            <option value="">Select province</option>
            {CANADIAN_PROVINCE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Postal code{required ? ' *' : ''}
          <input
            value={normalizedValue.postalCode ?? ''}
            onChange={(event) => patchAddress({ postalCode: normalizeCanadianPostalCode(event.target.value) })}
            disabled={disabled}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase tracking-[0.08em] focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="A1A 1A1"
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Country
          <input
            value="Canada"
            disabled
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {showShippingFields && onDefaultChange ? (
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => onDefaultChange(event.target.checked)}
              disabled={disabled}
              className="h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
            />
            Set as default shipping address
          </label>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Map preview</p>
          <p className="mt-1 text-xs text-slate-600">
            {preview
              ? 'Preview is based on your postal code or captured location.'
              : hasAnyAddress
                ? previewError ?? 'Add a postal code or use your location to preview the map.'
                : 'Add an address to preview the map.'}
          </p>
        </div>
        <div className="p-4">
          {preview ? (
            <CivilDistrictMap context={preview} />
          ) : (
            <div className="flex h-[220px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">
              {previewLoading ? 'Loading map preview…' : previewError ?? 'Map preview will appear here once we can resolve the location.'}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}