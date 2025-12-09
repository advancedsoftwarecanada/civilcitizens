"use client"

import { useEffect } from 'react'

type PageProps = {
  params: {
    province: string
    chamber: string
  }
}

// Legacy chamber route: gently redirect to the community path while keeping the build green.
export default function ChamberFeedPage({ params }: PageProps) {
  useEffect(() => {
    const provinceParam = decodeURIComponent(params.province)
    const chamberParam = decodeURIComponent(params.chamber)
    const target = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`
    if (typeof window !== 'undefined') {
      window.location.replace(target)
    }
  }, [params.chamber, params.province])

  return (
    <main className="flex min-h-screen items-center justify-center p-8 text-sm text-slate-600">
      Redirecting to the updated community route…
    </main>
  )
}
