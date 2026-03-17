import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_OSRM_SERVER = 'http://192.168.2.254:5000'

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function getOsrmServerBaseUrl() {
  const configured = (process.env.OSRM_SERVER || '').trim()
  return trimTrailingSlash(configured || DEFAULT_OSRM_SERVER)
}

function buildUpstreamUrl(req: NextRequest, path: string[]) {
  const upstreamBase = getOsrmServerBaseUrl()
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/')
  return `${upstreamBase}/${encodedPath}${req.nextUrl.search}`
}

async function proxyOsrmRequest(req: NextRequest, path: string[]) {
  if (!path.length) {
    return NextResponse.json({ error: 'osrm_path_required' }, { status: 400 })
  }

  const upstreamResponse = await fetch(buildUpstreamUrl(req, path), {
    method: req.method,
    headers: {
      accept: req.headers.get('accept') || 'application/json',
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
    routePath: string[]
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxyOsrmRequest(req, context.params.routePath)
}

export async function HEAD(req: NextRequest, context: RouteContext) {
  return proxyOsrmRequest(req, context.params.routePath)
}