import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_NOMINATIM_SERVER = 'https://maplerides.ca/nominatim'

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function getNominatimServerBaseUrl() {
  const configured = (process.env.NOMINATIM_SERVER || '').trim()
  return trimTrailingSlash(configured || DEFAULT_NOMINATIM_SERVER)
}

function buildUpstreamUrl(req: NextRequest, path: string[]) {
  const upstreamBase = getNominatimServerBaseUrl()
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/')
  return `${upstreamBase}/${encodedPath}${req.nextUrl.search}`
}

async function proxyNominatimRequest(req: NextRequest, path: string[]) {
  if (!path.length) {
    return NextResponse.json({ error: 'nominatim_path_required' }, { status: 400 })
  }

  const upstreamResponse = await fetch(buildUpstreamUrl(req, path), {
    method: req.method,
    headers: {
      accept: req.headers.get('accept') || 'application/json',
      'accept-language': req.headers.get('accept-language') || 'en-CA,en;q=0.9',
      'user-agent': req.headers.get('user-agent') || 'Civil/MapleRides Nominatim Proxy',
    },
    redirect: 'follow',
    cache: 'no-store',
  })

  if (req.method === 'HEAD') {
    return new NextResponse(null, {
      status: upstreamResponse.status,
      headers: upstreamResponse.headers,
    })
  }

  const contentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8'
  const body = await upstreamResponse.text()

  return new NextResponse(body, {
    status: upstreamResponse.status,
    headers: {
      'content-type': contentType,
      'cache-control': upstreamResponse.headers.get('cache-control') || 'no-store',
    },
  })
}

type RouteContext = {
  params: {
    nominatimPath: string[]
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxyNominatimRequest(req, context.params.nominatimPath)
}

export async function HEAD(req: NextRequest, context: RouteContext) {
  return proxyNominatimRequest(req, context.params.nominatimPath)
}