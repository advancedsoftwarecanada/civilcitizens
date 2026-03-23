'use client'

import { useEffect, useRef } from 'react'
import { isNotificationPayload, subscribeToNotificationsStream } from './notifications/notificationStream'

const DRIVE_REQUESTER_SOUND_NOTIFICATION_TYPES = new Set(['drive_ride_contract_update', 'delivery_contract_update'])

export default function DriveRequesterNotificationAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seenNotificationIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return subscribeToNotificationsStream((payload) => {
      if (!isNotificationPayload(payload)) return
      if (!DRIVE_REQUESTER_SOUND_NOTIFICATION_TYPES.has(payload.data.type)) return
      if (seenNotificationIdsRef.current.has(payload.data.id)) return

      seenNotificationIdsRef.current.add(payload.data.id)

      try {
        const audio = audioRef.current ?? new Audio()
        if (!audioRef.current) {
          const preferredSource = audio.canPlayType('audio/x-caf') ? '/honk-honk.caf' : '/honk-honk.mp3'
          audio.src = preferredSource
          audio.preload = 'auto'
        }
        audioRef.current = audio
        audio.currentTime = 0
        void audio.play().catch(() => undefined)
      } catch {
        return
      }
    })
  }, [])

  return null
}