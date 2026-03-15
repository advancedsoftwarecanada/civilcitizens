import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_MAP_TILE_SERVER = 'http://192.168.2.254:8080'

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function getMapTileServerBaseUrl() {
  const configured = (process.env.MAP_TILE_SERVER || '').trim()
  return trimTrailingSlash(configured || DEFAULT_MAP_TILE_SERVER)
}

function buildUpstreamUrl(req: NextRequest, path: string[]) {
  const upstreamBase = getMapTileServerBaseUrl()
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/')
  return `${upstreamBase}/${encodedPath}${req.nextUrl.search}`
}

function readForwardedHeader(req: NextRequest, name: string) {
  const raw = req.headers.get(name)
  if (!raw) return null
  return raw.split(',')[0]?.trim() || null
}

function readSchemeFromUrlHeader(req: NextRequest, name: string) {
  const raw = req.headers.get(name)
  if (!raw) return null
  try {
    return new URL(raw).protocol.replace(/:$/, '')
  } catch {
    return null
  }
}

function readCloudflareScheme(req: NextRequest) {
  const raw = req.headers.get('cf-visitor')
  if (!raw) return null
  const match = raw.match(/"scheme":"(https|http)"/i)
  return match?.[1]?.toLowerCase() || null
}

function buildProxyBaseUrl(req: NextRequest) {
  const forwardedHost = readForwardedHeader(req, 'x-forwarded-host')
  const host = forwardedHost || readForwardedHeader(req, 'host') || req.nextUrl.host
  const originProto = readSchemeFromUrlHeader(req, 'origin')
  const refererProto = readSchemeFromUrlHeader(req, 'referer')
  const cloudflareProto = readCloudflareScheme(req)
  const forwardedProto = readForwardedHeader(req, 'x-forwarded-proto')
  const inferredPublicProto = host.endsWith('civilcitizens.ca') ? 'https' : null
  const proto = originProto || refererProto || cloudflareProto || inferredPublicProto || forwardedProto || req.nextUrl.protocol.replace(/:$/, '') || 'http'
  return `${proto}://${host}/maps`
}

function rewriteJsonUrls(value: unknown, upstreamBase: string, proxyBase: string): unknown {
  if (typeof value === 'string') {
    if (value.startsWith(upstreamBase)) {
      return `${proxyBase}${value.slice(upstreamBase.length)}`
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteJsonUrls(entry, upstreamBase, proxyBase))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, rewriteJsonUrls(entry, upstreamBase, proxyBase)]),
    )
  }

  return value
}

async function proxyMapRequest(req: NextRequest, path: string[]) {
  if (!path.length) {
    return NextResponse.json({ error: 'map_path_required' }, { status: 400 })
  }

  const upstreamBase = getMapTileServerBaseUrl()
  const upstreamUrl = buildUpstreamUrl(req, path)
  const upstreamResponse = await fetch(upstreamUrl, {
    method: req.method,
    headers: {
      accept: req.headers.get('accept') || '*/*',
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

  const contentType = upstreamResponse.headers.get('content-type') || ''
  const proxyBase = buildProxyBaseUrl(req)

  if (contentType.includes('application/json') || path[path.length - 1]?.endsWith('.json')) {
    const payload = await upstreamResponse.json().catch(() => null)
    if (payload === null) {
      return new NextResponse(await upstreamResponse.text(), {
        status: upstreamResponse.status,
        headers: {
          'content-type': contentType || 'application/json; charset=utf-8',
        },
      })
    }

    const rewritten = rewriteJsonUrls(payload, upstreamBase, proxyBase)
    return NextResponse.json(rewritten, {
      status: upstreamResponse.status,
      headers: {
        'cache-control': upstreamResponse.headers.get('cache-control') || 'no-store',
      },
    })
  }

  const body = await upstreamResponse.arrayBuffer()
  const headers = new Headers(upstreamResponse.headers)
  headers.delete('content-length')
  return new NextResponse(body, {
    status: upstreamResponse.status,
    headers,
  })
}

type RouteContext = {
  params: {
    mapPath: string[]
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxyMapRequest(req, context.params.mapPath)
}

export async function HEAD(req: NextRequest, context: RouteContext) {
  return proxyMapRequest(req, context.params.mapPath)
}