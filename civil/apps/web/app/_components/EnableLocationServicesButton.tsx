'use client'

import { useState } from 'react'
import { requestLocationPermission, type CivilLocation, type CivilLocationResult } from '../_lib/locationService'
import { pushToast } from './useToasts'

type EnableLocationServicesButtonProps = {
  label?: string
  reason: string
  className?: string
  disabled?: boolean
  highAccuracy?: boolean
  timeoutMs?: number
  maximumAgeMs?: number
  successMessage?: string
  errorMessage?: string
  onEnabled?: (location: CivilLocation) => void | Promise<void>
  onResult?: (result: CivilLocationResult) => void
}

export default function EnableLocationServicesButton({
  label = 'Enable Location Services',
  reason,
  className,
  disabled = false,
  highAccuracy = true,
  timeoutMs = 10_000,
  maximumAgeMs = 60_000,
  successMessage = 'Location services enabled.',
  errorMessage,
  onEnabled,
  onResult,
}: EnableLocationServicesButtonProps) {
  const [pending, setPending] = useState(false)

  async function handleClick() {
    if (pending || disabled) return

    setPending(true)
    try {
      const result = await requestLocationPermission({
        reason,
        highAccuracy,
        timeoutMs,
        maximumAgeMs,
      })

      onResult?.(result)

      if (!result.ok || !result.location) {
        pushToast(errorMessage ?? result.errorMessage ?? 'Location services are unavailable right now.', 'error')
        return
      }

      await onEnabled?.(result.location)
      pushToast(successMessage, 'success')
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || pending}
      className={className}
    >
      {pending ? 'Enabling...' : label}
    </button>
  )
}
