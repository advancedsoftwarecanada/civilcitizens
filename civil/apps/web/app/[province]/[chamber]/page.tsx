"use client"

import ChamberFeedPage from '../../c/[province]/[chamber]/page'

type PageProps = {
  params: {
    province: string
    chamber: string
  }
}

export default function ProvinceChamberPage({ params }: PageProps) {
  return <ChamberFeedPage params={params} />
}
