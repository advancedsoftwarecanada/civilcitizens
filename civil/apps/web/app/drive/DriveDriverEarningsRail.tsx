'use client'

import { useEffect, useState } from 'react'
import Block from '../_components/Block'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { formatDriveMoney, type DriveDriverEarningsSummary } from './driveShared'

const EMPTY_SUMMARY: DriveDriverEarningsSummary = {
  todayEarningsCents: 0,
  todayHourlyEarningsCents: 0,
  thisWeekEarningsCents: 0,
  thisWeekHourlyEarningsCents: 0,
  todayKm: 0,
  thisWeekKm: 0,
}

function formatKilometers(value: number) {
  return `${(Number(value) || 0).toFixed(1)} km`
}

export default function DriveDriverEarningsRail({ enabled = true }: { enabled?: boolean }) {
  const [loading, setLoading] = useState(enabled)
  const [summary, setSummary] = useState<DriveDriverEarningsSummary>(EMPTY_SUMMARY)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setSummary(EMPTY_SUMMARY)
      setError(null)
      return
    }

    let cancelled = false

    async function loadSummary() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildApiUrl('/drive/driver/earnings-summary'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveDriverEarningsSummary | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok) {
          setSummary(EMPTY_SUMMARY)
          setError(payload?.error ?? 'Unable to load earnings right now.')
          return
        }

        setSummary({
          todayEarningsCents: Math.max(0, Number(payload?.todayEarningsCents) || 0),
          todayHourlyEarningsCents: Math.max(0, Number(payload?.todayHourlyEarningsCents) || 0),
          thisWeekEarningsCents: Math.max(0, Number(payload?.thisWeekEarningsCents) || 0),
          thisWeekHourlyEarningsCents: Math.max(0, Number(payload?.thisWeekHourlyEarningsCents) || 0),
          todayKm: Number(payload?.todayKm) || 0,
          thisWeekKm: Number(payload?.thisWeekKm) || 0,
        })
      } catch (summaryError) {
        console.error('Failed to load driver earnings summary', summaryError)
        if (cancelled) return
        setSummary(EMPTY_SUMMARY)
        setError('Unable to load earnings right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSummary()
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!enabled) return null

  const rows = [
    { label: 'Todays Earnings', value: formatDriveMoney(summary.todayEarningsCents) },
    { label: 'Todays Hourly Earnings', value: `${formatDriveMoney(summary.todayHourlyEarningsCents)}/hr` },
    { label: 'This weeks Earnings', value: formatDriveMoney(summary.thisWeekEarningsCents) },
    { label: 'This weeks Hourly earnings', value: `${formatDriveMoney(summary.thisWeekHourlyEarningsCents)}/hr` },
    { label: 'Todays KM', value: formatKilometers(summary.todayKm) },
    { label: 'This weeks KM', value: formatKilometers(summary.thisWeekKm) },
  ]

  return (
    <Block title="Driver Earnings">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <span className="text-sm text-slate-600">{row.label}</span>
            <span className="text-sm font-semibold text-slate-950">{loading ? '…' : row.value}</span>
          </div>
        ))}
      </div>
    </Block>
  )
}