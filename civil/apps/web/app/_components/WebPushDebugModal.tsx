'use client'

import { useEffect, useState } from 'react'
import Modal from './Modal'
import { clearWebPushDebugState, readWebPushDebugState, type WebPushDebugState } from '../_lib/webPushDebug'

function shouldOpen(state: WebPushDebugState | null): boolean {
  if (!state) return false
  if (state.platformContext === 'other') return false
  if (state.result.startsWith('skipped_')) return false
  if (state.result === 'subscription_sync_skipped_unchanged') return false
  if (state.error) return true
  if (state.result === 'sync_failed') return true
  return false
}

export default function WebPushDebugModal() {
  const [state, setState] = useState<WebPushDebugState | null>(null)
  const [dismissedAt, setDismissedAt] = useState(0)

  useEffect(() => {
    const refresh = () => {
      setState(readWebPushDebugState())
    }

    refresh()
    const intervalId = window.setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const open = shouldOpen(state) && (state?.updatedAt ?? 0) > dismissedAt

  return (
    <Modal open={open} onClose={() => setDismissedAt(Date.now())} title="Web Push Debug" maxWidthClassName="max-w-lg" closeOnBackdrop={false}>
      <div className="space-y-4 text-sm text-slate-700">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900">
          <div className="font-semibold">Installed PWA web-push sync</div>
          <div>Result: {state?.result ?? 'unknown'}</div>
          <div>Error: {state?.error ?? 'none'}</div>
        </div>

        <div className="grid gap-2">
          <div><span className="font-semibold">Source:</span> {state?.source ?? 'unknown'}</div>
          <div><span className="font-semibold">Platform context:</span> {state?.platformContext ?? 'unknown'}</div>
          <div><span className="font-semibold">Permission:</span> {state?.permission ?? 'unknown'}</div>
          <div><span className="font-semibold">Can enable:</span> {state?.canEnable ? 'yes' : 'no'}</div>
          <div><span className="font-semibold">Support error:</span> {state?.supportError ?? 'none'}</div>
          <div><span className="font-semibold">Has auth token:</span> {state?.hasAuthToken ? 'yes' : 'no'}</div>
          <div><span className="font-semibold">Existing subscription:</span> {state?.hasExistingSubscription === null ? 'unknown' : state?.hasExistingSubscription ? 'yes' : 'no'}</div>
          <div><span className="font-semibold">Endpoint host:</span> {state?.endpointHost ?? 'none'}</div>
          <div><span className="font-semibold">Path:</span> {state?.currentPath ?? 'unknown'}</div>
          <div><span className="font-semibold">Visibility:</span> {state?.visibilityState ?? 'unknown'}</div>
          <div><span className="font-semibold">Updated:</span> {state ? new Date(state.updatedAt).toLocaleTimeString() : 'unknown'}</div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              clearWebPushDebugState()
              setState(null)
              setDismissedAt(Date.now())
            }}
            className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700"
          >
            Clear debug state
          </button>
        </div>
      </div>
    </Modal>
  )
}
