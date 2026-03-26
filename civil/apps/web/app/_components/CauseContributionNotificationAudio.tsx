'use client'

import { useEffect, useRef } from 'react'
import { getNativePlatformName } from '../_lib/nativePush'
import { isNotificationPayload, subscribeToNotificationsStream } from './notifications/notificationStream'

const CAUSE_CONTRIBUTION_SOUND_NOTIFICATION_TYPES = new Set(['cause_contribution_received_creator'])

function getCauseContributionSoundSources() {
  return getNativePlatformName() === 'ios' ? ['/money.caf', '/money.mp3'] : ['/money.mp3', '/money.caf']
}

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
          const sourceQueue = getCauseContributionSoundSources()
          const pickNextSource = () => {
            const nextSource = sourceQueue.shift()
            if (!nextSource) return false
            audio.src = nextSource
            return true
          }
          audio.onerror = () => {
            if (!pickNextSource()) return
            void audio.play().catch(() => undefined)
          }
          pickNextSource()
          audio.preload = 'auto'
          audio.volume = 1
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