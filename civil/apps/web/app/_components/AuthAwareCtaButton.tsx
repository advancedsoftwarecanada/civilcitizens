'use client'

import type { ReactNode } from 'react'
import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type AuthAwareCtaButtonProps = {
  children: ReactNode
  className: string
  ariaLabel?: string
  href?: string
  unauthenticatedHref?: string
}

export default function AuthAwareCtaButton({
  children,
  className,
  ariaLabel,
  href,
  unauthenticatedHref = '/register',
}: AuthAwareCtaButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const authenticatedHref = href ?? '/home'

  useEffect(() => {
    void router.prefetch(unauthenticatedHref)
    void router.prefetch(authenticatedHref)
  }, [authenticatedHref, router, unauthenticatedHref])

  const handleClick = () => {
    const target = typeof window !== 'undefined' && window.localStorage.getItem('token')?.trim()
      ? authenticatedHref
      : unauthenticatedHref
    startTransition(() => {
      router.push(target)
    })
  }

  return (
    <button type="button" aria-label={ariaLabel} className={className} onClick={handleClick} disabled={isPending}>
      {children}
    </button>
  )
}
