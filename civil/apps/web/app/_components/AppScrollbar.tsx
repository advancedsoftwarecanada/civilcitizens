'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const MIN_THUMB_HEIGHT = 56

type ScrollMetrics = {
  visible: boolean
  thumbHeight: number
  thumbOffset: number
}

function getRootScroller() {
  if (typeof document === 'undefined') return null
  return document.getElementById('cc-app-root')
}

export default function AppScrollbar() {
  const [metrics, setMetrics] = useState<ScrollMetrics>({ visible: false, thumbHeight: MIN_THUMB_HEIGHT, thumbOffset: 0 })
  const [enabled, setEnabled] = useState(false)
  const dragStateRef = useRef<{ startY: number; startScrollTop: number } | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
    const syncEnabled = () => setEnabled(mediaQuery.matches)
    syncEnabled()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncEnabled)
      return () => mediaQuery.removeEventListener('change', syncEnabled)
    }

    mediaQuery.addListener(syncEnabled)
    return () => mediaQuery.removeListener(syncEnabled)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setMetrics({ visible: false, thumbHeight: MIN_THUMB_HEIGHT, thumbOffset: 0 })
      return
    }

    const root = getRootScroller()
    if (!root) return

    const syncMetrics = () => {
      const { clientHeight, scrollHeight, scrollTop } = root
      const visible = scrollHeight > clientHeight + 1
      if (!visible) {
        setMetrics({ visible: false, thumbHeight: MIN_THUMB_HEIGHT, thumbOffset: 0 })
        return
      }

      const trackHeight = clientHeight - 16
      const thumbHeight = Math.max(MIN_THUMB_HEIGHT, Math.round((clientHeight / scrollHeight) * trackHeight))
      const maxThumbOffset = Math.max(0, trackHeight - thumbHeight)
      const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
      const thumbOffset = Math.round((scrollTop / maxScrollTop) * maxThumbOffset)
      setMetrics({ visible: true, thumbHeight, thumbOffset })
    }

    syncMetrics()

    root.addEventListener('scroll', syncMetrics, { passive: true })
    window.addEventListener('resize', syncMetrics)
    const resizeObserver = new ResizeObserver(syncMetrics)
    resizeObserver.observe(root)
    if (root.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(root.firstElementChild)
    }

    return () => {
      root.removeEventListener('scroll', syncMetrics)
      window.removeEventListener('resize', syncMetrics)
      resizeObserver.disconnect()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      const root = getRootScroller()
      if (!dragState || !root) return

      const deltaY = event.clientY - dragState.startY
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight)
      const trackHeight = Math.max(1, root.clientHeight - 16 - metrics.thumbHeight)
      const scrollDelta = (deltaY / trackHeight) * maxScrollTop
      root.scrollTop = dragState.startScrollTop + scrollDelta
    }

    const handlePointerUp = () => {
      dragStateRef.current = null
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [enabled, metrics.thumbHeight])

  const thumbStyle = useMemo(
    () => ({
      height: `${metrics.thumbHeight}px`,
      transform: `translateY(${metrics.thumbOffset}px)`,
    }),
    [metrics.thumbHeight, metrics.thumbOffset],
  )

  if (!enabled || !metrics.visible) return null

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-[70] hidden w-5 lg:block" aria-hidden="true">
      <div className="absolute inset-y-2 right-1 flex w-3 justify-center rounded-full bg-[linear-gradient(180deg,rgba(248,250,252,0.42)_0%,rgba(226,232,240,0.2)_100%)]">
        <button
          type="button"
          className="pointer-events-auto absolute left-0 right-0 rounded-full border border-white/70 bg-[linear-gradient(180deg,#c01c15_0%,#851812_100%)] shadow-[0_8px_18px_rgba(133,24,18,0.24)] transition hover:brightness-105"
          style={thumbStyle}
          onPointerDown={(event) => {
            const root = getRootScroller()
            if (!root) return
            dragStateRef.current = { startY: event.clientY, startScrollTop: root.scrollTop }
            document.body.style.userSelect = 'none'
          }}
        />
      </div>
    </div>
  )
}