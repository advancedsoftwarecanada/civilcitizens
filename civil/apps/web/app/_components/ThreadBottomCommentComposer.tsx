"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { HiOutlinePaperAirplane, HiOutlinePhoto } from 'react-icons/hi2'
import MobileBottomInputShell from './MobileBottomInputShell'
import { pushToast } from './useToasts'
import { readMobileKeyboardSnapshot, useMobileKeyboardState } from '../_lib/mobileKeyboard'

type ThreadBottomCommentComposerProps = {
  onSubmit: (body: string) => Promise<void>
  placeholder?: string
  ariaLabel?: string
  replyHandle?: string | null
  onCancelReply?: (() => void) | null
  autoFocus?: boolean
  composerId?: string | null
}

export default function ThreadBottomCommentComposer({
  onSubmit,
  placeholder = 'Your comment…',
  ariaLabel = 'Comment composer',
  replyHandle = null,
  onCancelReply = null,
  autoFocus = false,
  composerId = null,
}: ThreadBottomCommentComposerProps) {
  const keyboardState = useMobileKeyboardState()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const focusIntervalRef = useRef<number | null>(null)
  const focusTimeoutRef = useRef<number | null>(null)
  const touchAtRef = useRef(0)

  const canSubmit = value.trim().length > 0 && !submitting

  const clearFocusStabilization = useCallback(() => {
    if (focusIntervalRef.current) {
      window.clearInterval(focusIntervalRef.current)
      focusIntervalRef.current = null
    }
    if (focusTimeoutRef.current) {
      window.clearTimeout(focusTimeoutRef.current)
      focusTimeoutRef.current = null
    }
  }, [])

  const setScrollLock = useCallback((locked: boolean) => {
    if (typeof document === 'undefined') return
    document.body.classList.toggle('cc-mobile-scroll-lock', locked)
    document.documentElement.classList.toggle('cc-mobile-scroll-lock', locked)
  }, [])

  const focusComposerInput = useCallback(() => {
    const target = inputRef.current
    if (!target) return false

    target.focus({ preventScroll: true })
    const length = target.value.length
    target.setSelectionRange(length, length)
    return document.activeElement === target
  }, [])

  const scheduleFocusStabilization = useCallback(() => {
    if (!isMobileViewport) return

    clearFocusStabilization()

    let attempts = 0
    const runFocus = () => {
      attempts += 1
      const focused = focusComposerInput()
      const keyboardSnapshot = readMobileKeyboardSnapshot()
      if ((focused && keyboardSnapshot.keyboardOpen) || attempts >= 10) {
        clearFocusStabilization()
      }
    }

    runFocus()
    focusIntervalRef.current = window.setInterval(runFocus, 90)
    focusTimeoutRef.current = window.setTimeout(() => {
      clearFocusStabilization()
    }, 950)
  }, [clearFocusStabilization, focusComposerInput, isMobileViewport])

  const stopFocusStabilization = useCallback(() => {
    clearFocusStabilization()
  }, [clearFocusStabilization])

  const handlePressStart = useCallback(() => {
    if (!isMobileViewport) return
    setScrollLock(true)
  }, [isMobileViewport, setScrollLock])

  const markComposerTouch = useCallback(() => {
    touchAtRef.current = Date.now()
  }, [])

  const shouldIgnoreComposerClick = useCallback(() => Date.now() - touchAtRef.current < 750, [])

  const handleInputTouchStart = useCallback(
    (event: React.TouchEvent<HTMLInputElement>) => {
      if (!isMobileViewport) return
      event.preventDefault()
      event.stopPropagation()
      handlePressStart()
    },
    [handlePressStart, isMobileViewport],
  )

  const handleInputTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLInputElement>) => {
      if (!isMobileViewport) return
      event.preventDefault()
      event.stopPropagation()
      markComposerTouch()
      setInputFocused(true)
      focusComposerInput()
      scheduleFocusStabilization()
    },
    [focusComposerInput, isMobileViewport, markComposerTouch, scheduleFocusStabilization],
  )

  const submit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || submitting) return
    stopFocusStabilization()
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
  }, [onSubmit, stopFocusStabilization, submitting, value])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 1023px)')
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

  useEffect(() => {
    if (!isMobileViewport) {
      setScrollLock(false)
      return
    }

    setScrollLock(inputFocused || keyboardState.keyboardOpen)
  }, [inputFocused, isMobileViewport, keyboardState.keyboardOpen, setScrollLock])

  useEffect(() => {
    if (!autoFocus) return

    scheduleFocusStabilization()

    return () => {
      clearFocusStabilization()
    }
  }, [autoFocus, clearFocusStabilization, scheduleFocusStabilization])

  useEffect(
    () => () => {
      stopFocusStabilization()
      setScrollLock(false)
    },
    [setScrollLock, stopFocusStabilization],
  )

  return (
    <MobileBottomInputShell className="z-[90]">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-2" role="group" aria-label={ariaLabel}>
        {replyHandle ? (
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="min-w-0 text-xs font-semibold text-slate-500">
              Replying to <span className="text-slate-700">@{replyHandle}</span>
            </div>
            {onCancelReply ? (
              <button
                type="button"
                onClick={onCancelReply}
                className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 hover:text-slate-800"
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            data-thread-composer-id={composerId ?? undefined}
            type="text"
            value={value}
            onChange={(event) => {
              stopFocusStabilization()
              setValue(event.target.value)
            }}
            onPointerDown={handlePressStart}
            onMouseDown={handlePressStart}
            onTouchStart={handleInputTouchStart}
            onTouchEnd={handleInputTouchEnd}
            onFocus={() => {
              setInputFocused(true)
              scheduleFocusStabilization()
            }}
            onBlur={() => {
              setInputFocused(false)
              stopFocusStabilization()
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
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              stopFocusStabilization()
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              stopFocusStabilization()
            }}
            onTouchStart={(event) => {
              event.preventDefault()
              event.stopPropagation()
              stopFocusStabilization()
            }}
            onTouchEnd={(event) => {
              event.preventDefault()
              event.stopPropagation()
              markComposerTouch()
              pushToast('Comment images are coming soon.', 'info')
            }}
            onClick={(event) => {
              if (shouldIgnoreComposerClick()) {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              pushToast('Comment images are coming soon.', 'info')
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
            aria-label="Add image"
            title="Add image"
          >
            <HiOutlinePhoto className="h-5 w-5" />
          </button>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              stopFocusStabilization()
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              stopFocusStabilization()
            }}
            onTouchStart={(event) => {
              event.preventDefault()
              event.stopPropagation()
              stopFocusStabilization()
            }}
            onTouchEnd={(event) => {
              event.preventDefault()
              event.stopPropagation()
              markComposerTouch()
              void submit()
            }}
            onClick={(event) => {
              if (shouldIgnoreComposerClick()) {
                event.preventDefault()
                event.stopPropagation()
                return
              }
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
      </div>
    </MobileBottomInputShell>
  )
}
