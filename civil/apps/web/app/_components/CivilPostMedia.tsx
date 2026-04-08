'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildApiUrl } from '../_lib/api'
import { resolvePublicAssetUrl } from '../_lib/publicAssetUrl'
import { getStoredToken } from '../_lib/tokenStorage'

type CivilPostMediaProps = {
  images?: string[] | null
  mediaUrl?: string | null
  postId?: string | null
  video?: {
    assetId: string
    playbackUrl?: string | null
    thumbnailUrl?: string | null
    kind?: 'video' | 'podcast'
    sourceType?: 'video' | 'audio'
    mime?: string | null
    durationMs?: number | null
    width?: number | null
    height?: number | null
    status?: 'queued' | 'processing' | 'completed' | 'failed'
  } | null
  postUrl?: string | null
}

function buildPlaybackSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `podcast-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function CivilPostMedia({ images, mediaUrl, postId, video, postUrl }: CivilPostMediaProps) {
  const playbackUrl = resolvePublicAssetUrl(video?.playbackUrl ?? null, typeof window !== 'undefined' ? window.location.origin : null)
  const thumbnailUrl = resolvePublicAssetUrl(video?.thumbnailUrl ?? null, typeof window !== 'undefined' ? window.location.origin : null)
  const mediaElementRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null)
  const playbackSessionRef = useRef<{ sessionId: string; maxPositionSeconds: number; sent: boolean } | null>(null)
  const allImages = useMemo(() => {
    const rawImages = images && images.length > 0 ? images : mediaUrl ? [mediaUrl] : []
    return rawImages
      .map((value) => resolvePublicAssetUrl(value, typeof window !== 'undefined' ? window.location.origin : null))
      .filter((value): value is string => Boolean(value))
  }, [images, mediaUrl])
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)
  const shouldTrackPodcastPlayback = Boolean(postId && playbackUrl && video?.kind === 'podcast')

  const flushPlaybackAnalytics = useCallback(
    async (completedOverride?: boolean) => {
      if (!shouldTrackPodcastPlayback || !postId) return
      const session = playbackSessionRef.current
      const mediaElement = mediaElementRef.current
      if (!session || session.sent || !mediaElement) return

      const duration = Number.isFinite(mediaElement.duration) ? mediaElement.duration : null
      const currentPositionSeconds = Number.isFinite(mediaElement.currentTime) ? mediaElement.currentTime : 0
      const maxPositionSeconds = Math.max(session.maxPositionSeconds, currentPositionSeconds)
      const completed = Boolean(completedOverride) || (duration !== null && duration > 0 ? maxPositionSeconds / duration >= 0.95 : false)
      const watchSeconds = duration !== null ? Math.min(duration, maxPositionSeconds) : maxPositionSeconds
      if (!completed && watchSeconds < 3) {
        playbackSessionRef.current = null
        return
      }

      session.sent = true
      const token = getStoredToken()
      if (!token) {
        playbackSessionRef.current = null
        return
      }

      try {
        await fetch(buildApiUrl('/podcasts/analytics/playback'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          keepalive: true,
          body: JSON.stringify({
            postId,
            sessionId: session.sessionId,
            watchSeconds: Number(watchSeconds.toFixed(2)),
            maxPositionSeconds: Number(maxPositionSeconds.toFixed(2)),
            completed,
          }),
        })
      } catch {
        session.sent = false
      }
    },
    [postId, shouldTrackPodcastPlayback],
  )

  const startPlaybackSession = useCallback(() => {
    if (!shouldTrackPodcastPlayback) return
    if (!playbackSessionRef.current || playbackSessionRef.current.sent) {
      playbackSessionRef.current = {
        sessionId: buildPlaybackSessionId(),
        maxPositionSeconds: 0,
        sent: false,
      }
    }
  }, [shouldTrackPodcastPlayback])

  const updatePlaybackPosition = useCallback(() => {
    if (!shouldTrackPodcastPlayback || !mediaElementRef.current) return
    startPlaybackSession()
    const currentPositionSeconds = Number.isFinite(mediaElementRef.current.currentTime) ? mediaElementRef.current.currentTime : 0
    if (playbackSessionRef.current) {
      playbackSessionRef.current.maxPositionSeconds = Math.max(playbackSessionRef.current.maxPositionSeconds, currentPositionSeconds)
    }
  }, [shouldTrackPodcastPlayback, startPlaybackSession])

  useEffect(() => {
    if (!shouldTrackPodcastPlayback) return undefined

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushPlaybackAnalytics()
      }
    }
    const handlePageHide = () => {
      void flushPlaybackAnalytics()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      void flushPlaybackAnalytics()
    }
  }, [flushPlaybackAnalytics, shouldTrackPodcastPlayback])

  if (playbackUrl && video?.sourceType === 'audio') {
    return (
      <div
        className="overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_45%,#334155_100%)] p-5 text-white"
        data-prevent-card-nav="true"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
              {video.kind === 'podcast' ? 'Podcast Episode' : 'Audio Post'}
            </p>
            <p className="mt-2 text-sm text-white/70">
              {video.durationMs ? `${Math.max(1, Math.round(video.durationMs / 60000))} min` : 'Audio'}
            </p>
          </div>
        </div>
        <audio
          ref={(element) => {
            mediaElementRef.current = element
          }}
          className="w-full"
          controls
          preload="metadata"
          onPlay={startPlaybackSession}
          onTimeUpdate={updatePlaybackPosition}
          onEnded={() => {
            updatePlaybackPosition()
            void flushPlaybackAnalytics(true)
            playbackSessionRef.current = null
          }}
        >
          <source src={playbackUrl} type={video.mime ?? 'audio/mpeg'} />
        </audio>
      </div>
    )
  }

  if (playbackUrl) {
    return (
      <div
        className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950"
        data-prevent-card-nav="true"
      >
        <video
          ref={(element) => {
            mediaElementRef.current = element
          }}
          className="h-auto w-full max-h-[75vh] bg-black"
          controls
          playsInline
          preload="metadata"
          poster={thumbnailUrl ?? undefined}
          onPlay={startPlaybackSession}
          onTimeUpdate={updatePlaybackPosition}
          onEnded={() => {
            updatePlaybackPosition()
            void flushPlaybackAnalytics(true)
            playbackSessionRef.current = null
          }}
        >
          <source src={playbackUrl} type="video/mp4" />
        </video>
      </div>
    )
  }

  if (allImages.length === 0) return null

  const activeImageSrc = typeof activeImageIndex === 'number' ? allImages[activeImageIndex] ?? null : null

  const moveActiveImage = useCallback(
    (direction: 'prev' | 'next') => {
      if (allImages.length <= 1) return
      setActiveImageIndex((current) => {
        if (typeof current !== 'number') return current
        if (direction === 'prev') {
          return current === 0 ? allImages.length - 1 : current - 1
        }
        return current === allImages.length - 1 ? 0 : current + 1
      })
    },
    [allImages.length],
  )

  useEffect(() => {
    if (activeImageIndex === null) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveImageIndex(null)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveActiveImage('prev')
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveActiveImage('next')
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeImageIndex, moveActiveImage])

  if (allImages.length === 1) {
    const imageSrc = allImages[0]
    if (!imageSrc) return null
    const tiledBackdropStyle = {
      backgroundImage: `url("${imageSrc.replace(/"/g, '\\"')}")`,
      backgroundPosition: 'center',
      backgroundRepeat: 'repeat',
      backgroundSize: 'auto 100%',
    } as const
    const content = (
      <>
        <div className="absolute inset-[-8%] overflow-hidden" aria-hidden="true">
          <div
            className="h-full w-full scale-110 opacity-50 blur-3xl saturate-150 transition-transform duration-500 group-hover:scale-[1.16]"
            style={tiledBackdropStyle}
          />
          <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.18)_0%,rgba(15,23,42,0.08)_45%,rgba(15,23,42,0.18)_100%)]" />
        </div>
        <div className="relative flex min-h-[16rem] items-center justify-center bg-slate-950/8 px-2 py-2 sm:min-h-[20rem]">
          <img
            src={imageSrc}
            alt="Post image"
            className="relative z-[1] h-auto w-full max-h-[70vh] object-contain"
            loading="lazy"
          />
        </div>
      </>
    )

    if (postUrl) {
      return (
        <Link href={postUrl} className="group relative block overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
          {content}
        </Link>
      )
    }

    return (
      <>
        <button
          type="button"
          onClick={() => setActiveImageIndex(0)}
          className="group relative block w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-left"
          aria-label="Open image"
        >
          {content}
        </button>
        {activeImageSrc && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
                onClick={() => setActiveImageIndex(null)}
              >
                <button
                  type="button"
                  onClick={() => setActiveImageIndex(null)}
                  className="absolute right-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                >
                  Close
                </button>
                <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
                  <img
                    src={activeImageSrc}
                    alt="Post image full view"
                    className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl"
                  />
                </div>
              </div>,
              document.body,
            )
          : null}
      </>
    )
  }

  const displayImages = allImages.slice(0, 5)
  const remainingCount = allImages.length - 5

  return (
    <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:grid-cols-6">
      {displayImages.map((src, index) => {
        let className = 'relative aspect-square w-full overflow-hidden bg-slate-100'
        const isLast = index === displayImages.length - 1

        if (displayImages.length === 2) {
          className += ' col-span-1 sm:col-span-3'
        } else if (displayImages.length === 3) {
          if (index === 0) className += ' col-span-2 sm:col-span-4 row-span-2'
          else className += ' col-span-1 sm:col-span-2'
        } else if (displayImages.length === 4) {
          className += ' col-span-1 sm:col-span-3'
        } else if (displayImages.length >= 5) {
          if (index < 2) className += ' col-span-1 sm:col-span-3'
          else if (index === 4) className += ' col-span-2 sm:col-span-2'
          else className += ' col-span-1 sm:col-span-2'
        }

        const image = (
          <>
            <img src={src} alt={`Post image ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
            {isLast && remainingCount > 0 ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-bold text-white backdrop-blur-sm">
                +{remainingCount} more
              </div>
            ) : null}
          </>
        )

        if (postUrl) {
          return (
            <Link key={src} href={postUrl} className={className}>
              {image}
            </Link>
          )
        }

        return (
          <button
            key={`${src}-${index}`}
            type="button"
            onClick={() => setActiveImageIndex(index)}
            className={`${className} cursor-zoom-in text-left`}
            aria-label={`Open image ${index + 1}`}
          >
            {image}
          </button>
        )
      })}
      {activeImageSrc && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
              onClick={() => setActiveImageIndex(null)}
            >
              <button
                type="button"
                onClick={() => setActiveImageIndex(null)}
                className="absolute right-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
              >
                Close
              </button>
              {allImages.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      moveActiveImage('prev')
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      moveActiveImage('next')
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                  >
                    →
                  </button>
                </>
              ) : null}
              <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
                <img
                  src={activeImageSrc}
                  alt={`Post image ${activeImageIndex !== null ? activeImageIndex + 1 : 1} full view`}
                  className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl"
                />
              </div>
              <div className="absolute bottom-3 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                {(activeImageIndex ?? 0) + 1} / {allImages.length}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
