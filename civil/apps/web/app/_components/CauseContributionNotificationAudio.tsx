'use client'

import { useEffect, useRef } from 'react'
import { isNotificationPayload, subscribeToNotificationsStream } from './notifications/notificationStream'

const CAUSE_CONTRIBUTION_SOUND_NOTIFICATION_TYPES = new Set(['cause_contribution_received_creator'])

export default function CauseContributionNotificationAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seenNotificationIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return subscribeToNotificationsStream((payload) => {
      if (!isNotificationPayload(payload)) return
      if (!CAUSE_CONTRIBUTION_SOUND_NOTIFICATION_TYPES.has(payload.data.type)) return
      if (seenNotificationIdsRef.current.has(payload.data.id)) return

      seenNotificationIdsRef.current.add(payload.data.id)

      try {
        const audio = audioRef.current ?? new Audio()
        if (!audioRef.current) {
          const preferredSource = audio.canPlayType('audio/x-caf') ? '/money.caf' : '/money.mp3'
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