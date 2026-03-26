"use client"

import ChamberPostPage from '../../../../c/[province]/[chamber]/posts/[slug]/page'

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

export default function ProvinceChamberCausePage({ params }: PageProps) {
  return <ChamberPostPage params={params} />
}