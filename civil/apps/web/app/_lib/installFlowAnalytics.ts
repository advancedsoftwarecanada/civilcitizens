'use client'

import { buildApiUrl } from './api'

type InstallFlow = 'ios_pwa' | 'ios_switch_to_safari' | 'android_pwa' | 'android_apk'
type InstallEvent =
  | 'view'
  | 'install_cta_clicked'
  | 'install_prompt_opened'
  | 'install_prompt_accepted'
  | 'install_prompt_dismissed'
  | 'install_prompt_failed'
  | 'installed'
  | 'check_again_clicked'
  | 'check_again_not_installed'

type TrackInstallFlowEventInput = {
  flow: InstallFlow
  event: InstallEvent
  source?: string
  nextPath?: string
}

function getTokenForAnalytics(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const token = window.localStorage.getItem('token')
    return token && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

function buildPathForInstallEvent(input: TrackInstallFlowEventInput): string {
  const params = new URLSearchParams()
  params.set('flow', input.flow)
  params.set('event', input.event)
  if (typeof input.source === 'string' && input.source.trim()) params.set('source', input.source.trim())
  if (typeof input.nextPath === 'string' && input.nextPath.trim()) params.set('next', input.nextPath.trim())
  return `/install/track?${params.toString()}`
}

export async function trackInstallFlowEvent(input: TrackInstallFlowEventInput): Promise<void> {
  if (typeof window === 'undefined') return

  const token = getTokenForAnalytics()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`

  try {
    await fetch(buildApiUrl('/analytics/track'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: buildPathForInstallEvent(input),
        referrer: typeof document !== 'undefined' ? document.referrer : undefined,
      }),
    })
  } catch (error) {
    console.error('install_flow_track_failed', error)
  }
}
