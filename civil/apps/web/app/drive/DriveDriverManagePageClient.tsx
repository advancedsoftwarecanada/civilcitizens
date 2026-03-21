'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { pushToast } from '../_components/useToasts'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { getDeliveryRequirementItems, pickMediaVariantUrl, type DeliveryOnboardingResponse } from '../delivery/deliveryShared'
import DriveRouteNav from './DriveRouteNav'
import { formatDriveMoney, type DriveDriverManageResponse, type DriveDriverVehicle } from './driveShared'

type MediaAssetStatusResponse = {
  asset?: {
    status?: string
    failureReason?: string | null
    variants?: unknown
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldUseDirectUpload(url?: string | null) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:') return false
    return true
  } catch {
    return false
  }
}

async function uploadDriveVehiclePhoto(token: string, file: File) {
  const initRes = await fetch(buildApiUrl('/media/uploads'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      category: 'post_image',
      mime: file.type || 'application/octet-stream',
      byteSize: file.size,
      filename: file.name,
    }),
  })

  const initPayload = (await initRes.json().catch(() => null)) as {
    assetId?: string
    proxyPath?: string
    upload?: { url?: string; method?: string; headers?: Record<string, string> }
    error?: string
  } | null

  if (!initRes.ok || !initPayload?.assetId) throw new Error(initPayload?.error || 'upload_init_failed')

  let uploaded = false
  if (shouldUseDirectUpload(initPayload.upload?.url)) {
    try {
      const directRes = await fetch(initPayload.upload?.url as string, {
        method: initPayload.upload?.method || 'PUT',
        headers: initPayload.upload?.headers,
        body: file,
      })
      uploaded = directRes.ok
    } catch {
      uploaded = false
    }
  }

  if (!uploaded && initPayload.proxyPath) {
    const proxyRes = await fetch(buildApiUrl(initPayload.proxyPath), {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': file.type || 'application/octet-stream',
        'x-upload-byte-size': String(file.size),
      },
      body: file,
    })
    uploaded = proxyRes.ok
  }

  if (!uploaded) throw new Error('upload_failed')

  const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assetId: initPayload.assetId }),
  })
  if (!completeRes.ok) throw new Error('upload_complete_failed')

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(1000)
    const pollRes = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(initPayload.assetId)}`), {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!pollRes.ok) continue
    const pollPayload = (await pollRes.json().catch(() => null)) as MediaAssetStatusResponse | null
    if (pollPayload?.asset?.status === 'ready') {
      const mediaUrl = pickMediaVariantUrl(pollPayload.asset.variants)
      if (mediaUrl) return mediaUrl
      break
    }
    if (pollPayload?.asset?.status === 'failed') throw new Error(pollPayload.asset.failureReason || 'processing_failed')
  }

  throw new Error('processing_timeout')
}

function centsToDollarInput(value: number) {
  return (value / 100).toFixed(2)
}

function createEmptyVehicle(index: number): DriveDriverVehicle {
  const now = new Date().toISOString()
  return {
    id: `draft-${now}-${index}`,
    name: '',
    photoUrls: [],
    minimumRideAmountCents: 500,
    perKmFeeCents: 100,
    featured: index === 0,
    createdAt: now,
    updatedAt: now,
  }
}

export default function DriveDriverManagePageClient() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingVehicleId, setUploadingVehicleId] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<DriveDriverVehicle[]>([])
  const [onboarding, setOnboarding] = useState<DeliveryOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(buildApiUrl('/drive/driver/manage'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as (DriveDriverManageResponse & { onboarding?: DeliveryOnboardingResponse }) | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (response.status === 403 && payload?.error === 'driver_not_active') {
        setOnboarding(payload.onboarding ?? null)
        setVehicles([])
        return
      }

      if (!response.ok) {
        setError(payload?.error ?? 'Unable to load your vehicles right now.')
        setVehicles([])
        return
      }

      setOnboarding(null)
      setVehicles(Array.isArray(payload?.vehicles) ? payload.vehicles : [])
    } catch (loadError) {
      console.error('Failed to load driver vehicles', loadError)
      setError('Unable to load your vehicles right now.')
      setVehicles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const requirementItems = getDeliveryRequirementItems(onboarding?.requirements)

  const addVehicle = useCallback(() => {
    setVehicles((current) => {
      if (current.length >= 10) return current
      return [...current, createEmptyVehicle(current.length)]
    })
  }, [])

  const updateVehicle = useCallback((vehicleId: string, updater: (current: DriveDriverVehicle) => DriveDriverVehicle) => {
    setVehicles((current) => current.map((vehicle) => (vehicle.id === vehicleId ? updater(vehicle) : vehicle)))
  }, [])

  const removeVehicle = useCallback((vehicleId: string) => {
    setVehicles((current) => {
      const next = current.filter((vehicle) => vehicle.id !== vehicleId)
      return next.map((vehicle, index) => ({ ...vehicle, featured: next.some((entry) => entry.featured) ? vehicle.featured && next.find((entry) => entry.featured)?.id === vehicle.id : index === 0 }))
    })
  }, [])

  const setFeaturedVehicle = useCallback((vehicleId: string) => {
    setVehicles((current) => current.map((vehicle) => ({ ...vehicle, featured: vehicle.id === vehicleId })))
  }, [])

  const handleUploadPhotos = useCallback(
    async (vehicleId: string, files: FileList | null) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      if (!files?.length) return

      const target = vehicles.find((vehicle) => vehicle.id === vehicleId)
      if (!target) return

      const remainingSlots = Math.max(0, 8 - target.photoUrls.length)
      if (remainingSlots <= 0) {
        pushToast('Each vehicle can have up to 8 photos.', 'info')
        return
      }

      setUploadingVehicleId(vehicleId)
      try {
        const selected = Array.from(files).slice(0, remainingSlots)
        const uploadedUrls: string[] = []

        for (const file of selected) {
          const mediaUrl = await uploadDriveVehiclePhoto(token, file)
          uploadedUrls.push(mediaUrl)
        }

        updateVehicle(vehicleId, (current) => ({
          ...current,
          photoUrls: [...current.photoUrls, ...uploadedUrls].slice(0, 8),
        }))
        pushToast('Vehicle photos uploaded.', 'success')
      } catch (uploadError) {
        console.error('Failed to upload vehicle photos', uploadError)
        pushToast('Unable to upload vehicle photos right now.', 'error')
      } finally {
        setUploadingVehicleId(null)
      }
    },
    [updateVehicle, vehicles],
  )

  const saveVehicles = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (vehicles.length > 10) {
      pushToast('You can list up to 10 vehicles.', 'error')
      return
    }

    const invalidVehicle = vehicles.find((vehicle) => {
      if (!vehicle.name.trim()) return true
      if (!Number.isInteger(vehicle.minimumRideAmountCents) || vehicle.minimumRideAmountCents < 500) return true
      if (!Number.isInteger(vehicle.perKmFeeCents) || vehicle.perKmFeeCents < 100 || vehicle.perKmFeeCents > 300) return true
      if (vehicle.photoUrls.length > 8) return true
      return false
    })

    if (invalidVehicle) {
      pushToast('Please finish the vehicle details before saving.', 'error')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(buildApiUrl('/drive/driver/manage'), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicles,
        }),
      })
      const payload = (await response.json().catch(() => null)) as DriveDriverManageResponse | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to save vehicles right now.', 'error')
        return
      }

      setVehicles(Array.isArray(payload?.vehicles) ? payload.vehicles : [])
      pushToast('Vehicles saved.', 'success')
    } catch (saveError) {
      console.error('Failed to save vehicles', saveError)
      pushToast('Unable to save vehicles right now.', 'error')
    } finally {
      setSaving(false)
    }
  }, [vehicles])

  const featuredVehicleId = useMemo(() => vehicles.find((vehicle) => vehicle.featured)?.id ?? vehicles[0]?.id ?? null, [vehicles])

  return (
    <DashboardShell
      rightRail={<RightRail mode="drive" organizationLinkTarget="chat" />}
      showMobileRightRail
      mainClassName="space-y-6 pb-12"
      rightRailClassName="pb-12"
    >
      <DriveRouteNav />

      <section className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Driver</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Manage Vehicles</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addVehicle}
              disabled={loading || Boolean(onboarding) || vehicles.length >= 10}
              className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add Vehicle
            </button>
            <button
              type="button"
              onClick={() => void saveVehicles()}
              disabled={loading || Boolean(onboarding) || saving}
              className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Vehicles'}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">Loading vehicles…</div> : null}

      {!loading && onboarding ? (
        <section className="rounded-[1.8rem] border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-amber-950">Finish onboarding first</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {requirementItems.map((item) => (
              <div key={item.key} className={`rounded-2xl border px-4 py-3 text-sm ${item.met ? 'border-emerald-200 bg-white text-emerald-800' : 'border-amber-200 bg-white text-amber-900'}`}>
                <span className="font-semibold">{item.met ? 'Ready' : 'Needed'}</span>
                <p className="mt-1">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Link href="/drive/onboarding" className="inline-flex rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95">
              Open onboarding
            </Link>
          </div>
        </section>
      ) : null}

      {!loading && !onboarding && !vehicles.length ? (
        <div className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No vehicles added yet.
        </div>
      ) : null}

      {!loading && !onboarding && vehicles.length ? (
        <div className="space-y-4">
          {vehicles.map((vehicle, index) => (
            <article key={vehicle.id} className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Vehicle {index + 1}</p>
                  <p className="mt-2 text-sm text-slate-500">{vehicle.photoUrls.length}/8 photos</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setFeaturedVehicle(vehicle.id)}
                    className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition ${featuredVehicleId === vehicle.id ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'}`}
                  >
                    {featuredVehicleId === vehicle.id ? 'Featured' : 'Set as Featured'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVehicle(vehicle.id)}
                    className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Vehicle name</span>
                  <input
                    type="text"
                    value={vehicle.name}
                    onChange={(event) =>
                      updateVehicle(vehicle.id, (current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Tesla Model X"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Minimum ride amount</span>
                    <input
                      type="number"
                      min="5"
                      step="0.50"
                      value={centsToDollarInput(vehicle.minimumRideAmountCents)}
                      onChange={(event) =>
                        updateVehicle(vehicle.id, (current) => ({
                          ...current,
                          minimumRideAmountCents: Math.max(500, Math.round((Number(event.target.value) || 0) * 100)),
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Per km fee</span>
                    <input
                      type="number"
                      min="1"
                      max="3"
                      step="0.05"
                      value={centsToDollarInput(vehicle.perKmFeeCents)}
                      onChange={(event) =>
                        updateVehicle(vehicle.id, (current) => ({
                          ...current,
                          perKmFeeCents: Math.max(100, Math.min(300, Math.round((Number(event.target.value) || 0) * 100))),
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)]"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">Vehicle photos</p>
                  <label className="inline-flex cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900">
                    {uploadingVehicleId === vehicle.id ? 'Uploading…' : 'Upload photos'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={uploadingVehicleId === vehicle.id || vehicle.photoUrls.length >= 8}
                      onChange={(event) => {
                        void handleUploadPhotos(vehicle.id, event.target.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>

                {vehicle.photoUrls.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {vehicle.photoUrls.map((url, photoIndex) => (
                      <div key={`${vehicle.id}-${photoIndex}`} className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-slate-50">
                        <img src={url} alt={`${vehicle.name || 'Vehicle'} photo ${photoIndex + 1}`} className="h-36 w-full object-cover" />
                        <div className="p-3">
                          <button
                            type="button"
                            onClick={() =>
                              updateVehicle(vehicle.id, (current) => ({
                                ...current,
                                photoUrls: current.photoUrls.filter((entry) => entry !== url),
                              }))
                            }
                            className="text-sm font-semibold text-rose-700 transition hover:text-rose-800"
                          >
                            Remove photo
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.35rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Upload up to 8 photos for this vehicle.
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  Min ride {formatDriveMoney(vehicle.minimumRideAmountCents)}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {formatDriveMoney(vehicle.perKmFeeCents)}/km
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </DashboardShell>
  )
}
