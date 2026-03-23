'use client'

import { useEffect, useState } from 'react'
import Block from '../_components/Block'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import { formatDriveMoney, type DriveDriverEarningsSummary } from './driveShared'

const EMPTY_SUMMARY: DriveDriverEarningsSummary = {
  todayEarningsCents: 0,
  todayTipsCents: 0,
  todayHourlyEarningsCents: 0,
  thisWeekEarningsCents: 0,
  thisWeekTipsCents: 0,
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
          todayTipsCents: Math.max(0, Number(payload?.todayTipsCents) || 0),
          todayHourlyEarningsCents: Math.max(0, Number(payload?.todayHourlyEarningsCents) || 0),
          thisWeekEarningsCents: Math.max(0, Number(payload?.thisWeekEarningsCents) || 0),
          thisWeekTipsCents: Math.max(0, Number(payload?.thisWeekTipsCents) || 0),
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
    { label: 'Todays Tips', value: formatDriveMoney(summary.todayTipsCents), highlight: summary.todayTipsCents > 0 },
    { label: 'Todays Hourly Earnings', value: `${formatDriveMoney(summary.todayHourlyEarningsCents)}/hr` },
    { label: 'This weeks Earnings', value: formatDriveMoney(summary.thisWeekEarningsCents) },
    { label: 'This weeks Tips', value: formatDriveMoney(summary.thisWeekTipsCents) },
    { label: 'This weeks Hourly earnings', value: `${formatDriveMoney(summary.thisWeekHourlyEarningsCents)}/hr` },
    { label: 'Todays KM', value: formatKilometers(summary.todayKm) },
    { label: 'This weeks KM', value: formatKilometers(summary.thisWeekKm) },
  ]

  return (
    <Block title="Driver Earnings">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {!loading && summary.todayTipsCents > 0 ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="text-sm font-semibold text-emerald-800">Tip activity today</span>
          <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
            +{formatDriveMoney(summary.todayTipsCents)}
          </span>
        </div>
      ) : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={row.highlight
              ? 'flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3'
              : 'flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3'}
          >
            <span className={row.highlight ? 'text-sm font-medium text-emerald-900' : 'text-sm text-slate-600'}>{row.label}</span>
            <span className={row.highlight ? 'text-sm font-semibold text-emerald-900' : 'text-sm font-semibold text-slate-950'}>{loading ? '…' : row.value}</span>
          </div>
        ))}
      </div>
    </Block>
  )
}