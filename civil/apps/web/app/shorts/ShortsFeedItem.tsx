'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import type { ReactionType } from '@civil/shared'
import { LuArrowUpRight, LuHeart, LuMessageCircle, LuShare2, LuVolume2, LuVolumeX } from 'react-icons/lu'
import type { ApiPost } from '../_components/PostComposer'
import ShareSendModal from '../_components/ShareSendModal'
import { resolvePublicAssetUrl } from '../_lib/publicAssetUrl'
import { buildPostPath, buildPostShareTarget } from '../_lib/shareTarget'
import { stripCivilUrlsFromText } from '../_lib/civilLinks'
import { formatDisplayName } from '../_lib/text'

type ShortsFeedItemProps = {
  post: ApiPost
  isActive: boolean
  onVisible?: (postId: string) => void
  onReact?: (postId: string, reaction: ReactionType | null) => Promise<void> | void
  onOpenComments?: (postId: string) => void
  commentsDrawerOpen?: boolean
}

function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return value.toLocaleString()
}

function formatVideoTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00'
  const rounded = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function ShortsFeedItem({ post, isActive, onVisible, onReact, onOpenComments, commentsDrawerOpen = false }: ShortsFeedItemProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaPressRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [playbackPaused, setPlaybackPaused] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)

  const preferredBaseUrl = typeof window !== 'undefined' ? window.location.origin : null
  const postHref = buildPostPath(post)
  const shareTarget = useMemo(() => buildPostShareTarget(post), [post])
  const playbackUrl = resolvePublicAssetUrl(post.video?.playbackUrl ?? null, preferredBaseUrl)
  const posterUrl = resolvePublicAssetUrl(post.video?.thumbnailUrl ?? post.mediaUrl ?? null, preferredBaseUrl)
  const primaryImageUrl = resolvePublicAssetUrl(post.images?.[0] ?? post.mediaUrl ?? null, preferredBaseUrl)
  const backdropUrl = posterUrl ?? primaryImageUrl
  const isVideo = Boolean(playbackUrl)
  const viewerReaction = post.viewer?.reaction ?? null
  const reactionCount = post.reactions?.total ?? post.counts?.reactions ?? 0
  const commentCount = post.counts?.commentCount ?? 0
  const authorLabel = post.organization?.name
    ? formatDisplayName(post.organization.name)
    : formatDisplayName(post.author.name) || post.author.handle
  const profileHref = post.organization?.provinceCode && post.organization.communitySlug
    ? `/com/${post.organization.provinceCode.toLowerCase()}/${post.organization.communitySlug.toLowerCase()}/orgs/${post.organization.slug}`
    : `/u/${post.author.handle}`
  const description = stripCivilUrlsFromText(post.body).trim()
  const topicsLine = post.topicSlugs.slice(0, 4).map((slug) => `#${slug}`).join(' ')
  const progressPercent = durationSeconds > 0 ? Math.min(100, Math.max(0, (currentTimeSeconds / durationSeconds) * 100)) : 0
  const progressTrackStyle = {
    background: `linear-gradient(90deg, var(--cc-primary) 0%, var(--cc-primary) ${progressPercent}%, rgba(255,255,255,0.18) ${progressPercent}%, rgba(255,255,255,0.18) 100%)`,
  }

  useEffect(() => {
    const node = rootRef.current
    if (!node || !onVisible) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
            onVisible(post.id)
          }
        }
      },
      {
        threshold: [0.35, 0.65, 0.85],
      },
    )

    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [onVisible, post.id])

  useEffect(() => {
    const node = videoRef.current
    if (!node || !isVideo) return

    node.muted = isMuted
    node.defaultMuted = isMuted
  }, [isMuted, isVideo])

  useEffect(() => {
    const node = videoRef.current
    if (!node || !isVideo) return

    if (isActive && !playbackPaused) {
      const playPromise = node.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => undefined)
      }
      return
    }

    node.pause()
  }, [isActive, isVideo, playbackPaused, isMuted])

  useEffect(() => {
    if (!isActive) {
      setPlaybackPaused(false)
    }
  }, [isActive])

  useEffect(() => {
    const node = videoRef.current
    if (!node || !isVideo) return

    const syncTiming = () => {
      setDurationSeconds(Number.isFinite(node.duration) ? node.duration : 0)
      setCurrentTimeSeconds(Number.isFinite(node.currentTime) ? node.currentTime : 0)
    }

    syncTiming()
    node.addEventListener('loadedmetadata', syncTiming)
    node.addEventListener('durationchange', syncTiming)
    node.addEventListener('timeupdate', syncTiming)
    node.addEventListener('ended', syncTiming)

    return () => {
      node.removeEventListener('loadedmetadata', syncTiming)
      node.removeEventListener('durationchange', syncTiming)
      node.removeEventListener('timeupdate', syncTiming)
      node.removeEventListener('ended', syncTiming)
    }
  }, [isVideo])

  const handleMediaToggle = () => {
    if (!isVideo) return
    setPlaybackPaused((current) => !current)
  }

  const handleSeek = (value: number) => {
    const node = videoRef.current
    if (!node || !Number.isFinite(value)) return
    node.currentTime = value
    setCurrentTimeSeconds(value)
  }

  const handleMediaPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof HTMLElement && target.closest('[data-shorts-control="true"]')) {
      mediaPressRef.current = null
      return
    }
    mediaPressRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
    }
  }

  const handleMediaPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isVideo) return
    const target = event.target
    if (target instanceof HTMLElement && target.closest('[data-shorts-control="true"]')) {
      mediaPressRef.current = null
      return
    }
    const press = mediaPressRef.current
    mediaPressRef.current = null
    if (!press) return

    const deltaX = Math.abs(event.clientX - press.x)
    const deltaY = Math.abs(event.clientY - press.y)
    const elapsedMs = Date.now() - press.time
    if (deltaX <= 12 && deltaY <= 12 && elapsedMs <= 260) {
      handleMediaToggle()
    }
  }

  const handleMediaPointerCancel = () => {
    mediaPressRef.current = null
  }

  const mobileOverlay = (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] px-5 pb-[calc(var(--mobile-dock-active-clearance)+1.25rem)] xl:hidden">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 max-w-[70%] text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <Link href={profileHref} className="pointer-events-auto text-base font-semibold hover:underline">
            {authorLabel}
          </Link>
          <p className="mt-1 text-sm text-white/80">@{post.author.handle}</p>
          {description ? <p className="mt-2 text-sm leading-6 text-white/90">{description}</p> : null}
        </div>
        <div className="pointer-events-auto flex flex-col items-center gap-3 text-white">
          <button
            type="button"
            onClick={() => void onReact?.(post.id, viewerReaction === 'heart' ? null : 'heart')}
            className={clsx('flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-md transition', viewerReaction === 'heart' ? 'border-rose-400 bg-rose-500 text-white' : 'border-white/20 bg-black/30 text-white')}
          >
            <LuHeart className="h-5 w-5" />
          </button>
          <Link href={postHref} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white backdrop-blur-md">
            <LuMessageCircle className="h-5 w-5" />
          </Link>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white backdrop-blur-md"
          >
            <LuShare2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <section
      ref={rootRef}
      data-shorts-post-id={post.id}
      className="relative flex h-[calc(var(--cc-viewport-height)-var(--cc-native-safe-top-offset)-var(--cc-native-shell-top-gap)-var(--mobile-dock-active-clearance)-1rem)] min-h-[calc(var(--cc-viewport-height)-var(--cc-native-safe-top-offset)-var(--cc-native-shell-top-gap)-var(--mobile-dock-active-clearance)-1rem)] snap-start [scroll-snap-stop:always] items-center justify-center px-3 py-3 sm:px-4 xl:h-full xl:min-h-0 xl:px-6"
    >
      <div className="absolute inset-0 overflow-hidden rounded-[2rem] bg-slate-950">
        {posterUrl || primaryImageUrl ? (
          <img
            src={posterUrl ?? primaryImageUrl ?? undefined}
            alt=""
            className="h-full w-full scale-110 object-cover opacity-35 blur-3xl"
            aria-hidden="true"
          />
        ) : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))]" />
      </div>

      <div className="relative z-[1] grid h-full w-full max-w-[1180px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,540px)_minmax(260px,320px)] xl:gap-8">
        <div className="flex min-h-0 items-center justify-center">
          <div className="relative h-full w-full overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-[0_35px_90px_rgba(0,0,0,0.45)]">
            {isVideo && playbackUrl ? (
              <div
                className="group relative h-full w-full"
                onPointerDown={handleMediaPointerDown}
                onPointerUp={handleMediaPointerUp}
                onPointerCancel={handleMediaPointerCancel}
              >
                {backdropUrl ? (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <img
                      src={backdropUrl}
                      alt=""
                      className="h-full w-full scale-110 object-cover opacity-50 blur-3xl"
                      aria-hidden="true"
                    />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_22%,rgba(2,6,23,0.3)_68%,rgba(2,6,23,0.72)_100%)]" />
                  </div>
                ) : null}
                <video
                  ref={videoRef}
                  className="pointer-events-none absolute inset-0 z-[1] h-full w-full bg-transparent object-contain"
                  src={playbackUrl}
                  poster={posterUrl ?? undefined}
                  autoPlay
                  muted={isMuted}
                  loop
                  playsInline
                  preload="metadata"
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setIsMuted((current) => !current)
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  data-shorts-control="true"
                  className="absolute left-4 top-4 z-[3] inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-3 py-2 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-black/60"
                  aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                >
                  {isMuted ? <LuVolumeX className="h-4 w-4" /> : <LuVolume2 className="h-4 w-4" />}
                  <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black via-black/45 to-transparent" />
                <div className={clsx('pointer-events-none absolute inset-0 flex items-center justify-center transition', playbackPaused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                  <div className="rounded-full border border-white/20 bg-black/45 px-5 py-3 text-sm font-semibold text-white backdrop-blur-md">
                    {playbackPaused ? 'Tap to Resume' : 'Tap to Pause'}
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 z-[2] px-4 pb-3 pt-10 sm:px-5">
                  <div className="rounded-2xl border border-white/10 bg-black/35 px-3 py-2.5 backdrop-blur-md">
                    <div className="flex items-center gap-3 text-[11px] font-semibold text-white/80">
                      <span className="min-w-[2.75rem] text-left">{formatVideoTime(currentTimeSeconds)}</span>
                      <input
                        type="range"
                        min={0}
                        max={durationSeconds || 0}
                        step={0.1}
                        value={Math.min(currentTimeSeconds, durationSeconds || currentTimeSeconds || 0)}
                        onChange={(event) => handleSeek(Number(event.target.value))}
                        onInput={(event) => handleSeek(Number((event.target as HTMLInputElement).value))}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        data-shorts-control="true"
                        className="cc-shorts-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15"
                        style={progressTrackStyle}
                        aria-label="Video progress"
                      />
                      <span className="min-w-[2.75rem] text-right">{formatVideoTime(durationSeconds)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : primaryImageUrl ? (
              <div className="relative h-full w-full bg-black">
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <img
                    src={primaryImageUrl}
                    alt=""
                    className="h-full w-full scale-110 object-cover opacity-50 blur-3xl"
                    aria-hidden="true"
                  />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_22%,rgba(2,6,23,0.3)_68%,rgba(2,6,23,0.72)_100%)]" />
                </div>
                <img src={primaryImageUrl} alt={post.title ?? 'Shorts media'} className="absolute inset-0 z-[1] h-full w-full object-contain" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black via-black/45 to-transparent" />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-white/70">Media unavailable</div>
            )}
          </div>
        </div>

        <aside className="hidden min-h-0 xl:flex xl:flex-col xl:justify-between xl:py-5">
          <div className="space-y-4 rounded-[2rem] border border-white/12 bg-white/8 p-5 text-white shadow-[0_24px_80px_rgba(2,6,23,0.28)] backdrop-blur-2xl">
            <div className="flex items-start gap-3">
              <Link href={profileHref} className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10">
                {post.author.avatarUrl ? (
                  <img src={post.author.avatarUrl} alt={authorLabel} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-semibold text-white">{authorLabel.slice(0, 2).toUpperCase()}</span>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={profileHref} className="block truncate text-lg font-semibold hover:underline">
                  {authorLabel}
                </Link>
                <p className="mt-1 text-sm text-white/70">@{post.author.handle}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.22em] text-white/45">Now Playing</p>
              </div>
            </div>

            {post.title ? <h2 className="text-2xl font-semibold leading-tight text-white">{post.title}</h2> : null}
            {description ? <p className="text-sm leading-7 text-white/88">{description}</p> : null}
            {topicsLine ? <p className="text-sm font-medium text-[rgba(255,255,255,0.72)]">{topicsLine}</p> : null}

            <Link
              href={postHref}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/16"
            >
              Open Thread
              <LuArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 pt-4">
            <button
              type="button"
              onClick={() => void onReact?.(post.id, viewerReaction === 'heart' ? null : 'heart')}
              className={clsx('flex items-center justify-between rounded-[1.5rem] border px-4 py-3 text-left text-white transition backdrop-blur-xl', viewerReaction === 'heart' ? 'border-rose-400/60 bg-rose-500/25' : 'border-white/12 bg-white/8 hover:bg-white/12')}
            >
              <span className="inline-flex items-center gap-3 text-sm font-semibold">
                <LuHeart className="h-5 w-5" />
                Like
              </span>
              <span className="text-sm font-semibold text-white/78">{formatCount(reactionCount)}</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenComments?.(post.id)}
              className={clsx(
                'flex items-center justify-between rounded-[1.5rem] border px-4 py-3 text-left text-white transition',
                commentsDrawerOpen
                  ? 'border-white/30 bg-white/16'
                  : 'border-white/12 bg-white/8 hover:bg-white/12',
              )}
            >
              <span className="inline-flex items-center gap-3 text-sm font-semibold">
                <LuMessageCircle className="h-5 w-5" />
                Comments
              </span>
              <span className="text-sm font-semibold text-white/78">{formatCount(commentCount)}</span>
            </button>

            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center justify-between rounded-[1.5rem] border border-white/12 bg-white/8 px-4 py-3 text-left text-white transition hover:bg-white/12"
            >
              <span className="inline-flex items-center gap-3 text-sm font-semibold">
                <LuShare2 className="h-5 w-5" />
                Share
              </span>
              <span className="text-xs uppercase tracking-[0.18em] text-white/55">Send</span>
            </button>
          </div>
        </aside>
      </div>

      {mobileOverlay}

      {shareOpen ? <ShareSendModal target={shareTarget} onClose={() => setShareOpen(false)} /> : null}
    </section>
  )
}