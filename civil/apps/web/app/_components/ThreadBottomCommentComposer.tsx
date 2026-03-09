"use client"

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { HiOutlinePaperAirplane, HiOutlinePhoto } from 'react-icons/hi2'
import { pushToast } from './useToasts'

const MOBILE_BREAKPOINT_QUERY = '(max-width: 1023px)'
const MOBILE_KEYBOARD_OPEN_MIN_INSET = 90
const MOBILE_KEYBOARD_OPEN_MIN_DELTA = 140

type ThreadBottomCommentComposerProps = {
  onSubmit: (body: string) => Promise<void>
  placeholder?: string
}

export default function ThreadBottomCommentComposer({
  onSubmit,
  placeholder = 'Your comment…',
}: ThreadBottomCommentComposerProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)

  const canSubmit = value.trim().length > 0 && !submitting

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport)
    } else {
      mediaQuery.addListener(syncViewport)
    }
    window.addEventListener('resize', syncViewport)
    window.addEventListener('orientationchange', syncViewport)

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncViewport)
      } else {
        mediaQuery.removeListener(syncViewport)
      }
      window.removeEventListener('resize', syncViewport)
      window.removeEventListener('orientationchange', syncViewport)
    }
  }, [])

  const syncKeyboardInset = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!isMobileViewport || !isFocused) {
      setKeyboardInset(0)
      return
    }
    const viewport = window.visualViewport
    const viewportHeight = viewport?.height ?? window.innerHeight
    const viewportOffsetTop = viewport?.offsetTop ?? 0
    const inset = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop)
    const heightDelta = Math.max(0, window.innerHeight - viewportHeight)
    const keyboardOpen = inset > MOBILE_KEYBOARD_OPEN_MIN_INSET || heightDelta > MOBILE_KEYBOARD_OPEN_MIN_DELTA
    setKeyboardInset(keyboardOpen ? inset : 0)
  }, [isFocused, isMobileViewport])

  useEffect(() => {
    syncKeyboardInset()
  }, [syncKeyboardInset])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      syncKeyboardInset()
    }
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', handler)
    viewport?.addEventListener('scroll', handler)
    window.addEventListener('resize', handler)
    window.addEventListener('orientationchange', handler)
    return () => {
      viewport?.removeEventListener('resize', handler)
      viewport?.removeEventListener('scroll', handler)
      window.removeEventListener('resize', handler)
      window.removeEventListener('orientationchange', handler)
    }
  }, [syncKeyboardInset])

  const submit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
      setValue('')
    } catch (error) {
      console.error('Unable to submit comment', error)
      pushToast('Unable to post your comment right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [onSubmit, submitting, value])

  if (!isMobileViewport || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-x-0 z-[90] min-h-[var(--mobile-thread-composer-height)] border-t border-slate-200 bg-white/95 px-3 pb-[var(--mobile-dock-bottom-pad)] pt-[var(--mobile-bottom-bar-top-pad)] shadow-[0_-8px_20px_rgba(15,23,42,0.08)] lg:hidden"
      style={{ bottom: `calc(var(--mobile-dock-bottom-offset) + ${Math.round(keyboardInset)}px)` }}
    >
      <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-2" role="group" aria-label="Comment composer">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => {
            setIsFocused(true)
            requestAnimationFrame(() => syncKeyboardInset())
          }}
          onBlur={() => {
            setIsFocused(false)
            setTimeout(() => syncKeyboardInset(), 80)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          enterKeyHint="send"
          inputMode="text"
          placeholder={placeholder}
          className="h-11 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
        />
        <button
          type="button"
          onClick={() => pushToast('Comment images are coming soon.', 'info')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
          aria-label="Add image"
          title="Add image"
        >
          <HiOutlinePhoto className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            void submit()
          }}
          disabled={!canSubmit}
          className={clsx(
            'inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition',
            canSubmit ? 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]' : 'cursor-not-allowed bg-slate-300',
          )}
          aria-label="Post comment"
          title="Post comment"
        >
          <HiOutlinePaperAirplane className="h-5 w-5" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
