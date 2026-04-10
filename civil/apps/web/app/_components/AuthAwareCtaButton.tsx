'use client'

import type { ReactNode } from 'react'
import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type AuthAwareCtaButtonProps = {
  children: ReactNode
  className: string
  ariaLabel?: string
}

export default function AuthAwareCtaButton({ children, className, ariaLabel }: AuthAwareCtaButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    void router.prefetch('/register')
    void router.prefetch('/home')
  }, [router])

  const handleClick = () => {
    const target = typeof window !== 'undefined' && window.localStorage.getItem('token')?.trim() ? '/home' : '/register'
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
