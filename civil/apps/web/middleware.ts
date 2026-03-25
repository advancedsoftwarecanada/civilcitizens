import { findCommunitiesBySlug } from '@civil/shared'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0] !== 'c') {
    return NextResponse.next()
  }

  const slug = decodeURIComponent(segments[1] ?? '').trim().toLowerCase()
  if (!slug) {
    return NextResponse.next()
  }

  const community = findCommunitiesBySlug(slug)[0] ?? null
  if (!community) {
    return NextResponse.next()
  }

  const target = request.nextUrl.clone()
  target.pathname = `/com/${encodeURIComponent(community.province.toLowerCase())}/${encodeURIComponent(community.slug)}/posts`
  target.search = request.nextUrl.search

  return NextResponse.redirect(target)
}

export const config = {
  matcher: ['/c/:slug'],
}
