'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useState } from 'react'
import type { ElectoralDistrictContextResponse } from '@civil/shared'
import { MapZoomControls } from './MapZoomControls'
import { resolvePartyVisual, type PartySummary } from '../../_lib/politics'

type CivilDistrictMapProps = {
  context: ElectoralDistrictContextResponse
  party?: PartySummary | null
  showUserLocation?: boolean
}

type BoundsTuple = [number, number, number, number]

const FALLBACK_SIZE = 360
const FALLBACK_PADDING = 18
const DISTRICT_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
} as const

function projectPoint(lng: number, lat: number, bounds: BoundsTuple) {
  const [minLng, minLat, maxLng, maxLat] = bounds
  const lngSpan = Math.max(maxLng - minLng, 0.000001)
  const latSpan = Math.max(maxLat - minLat, 0.000001)
  const usableSize = FALLBACK_SIZE - FALLBACK_PADDING * 2
  const x = FALLBACK_PADDING + ((lng - minLng) / lngSpan) * usableSize
  const y = FALLBACK_PADDING + (1 - (lat - minLat) / latSpan) * usableSize
  return [x, y] as const
}

function buildPolygonPath(rings: number[][][], bounds: BoundsTuple) {
  return rings
    .map((ring) => {
      if (!Array.isArray(ring) || ring.length === 0) return ''
      return ring
        .map((point, index) => {
          if (!Array.isArray(point) || point.length < 2) return ''
          const [x, y] = projectPoint(point[0] ?? 0, point[1] ?? 0, bounds)
          return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
        })
        .filter(Boolean)
        .concat('Z')
        .join(' ')
    })
    .filter(Boolean)
    .join(' ')
}

function buildDistrictPath(context: ElectoralDistrictContextResponse) {
  const geometry = context.district?.geometry
  const bounds = context.district?.bounds
  if (!geometry || !bounds) return null

  if (geometry.type === 'Polygon') {
    return buildPolygonPath(geometry.coordinates as number[][][], bounds)
  }

  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as number[][][][])
      .map((polygon) => buildPolygonPath(polygon, bounds))
      .filter(Boolean)
      .join(' ')
  }

  return null
}

function CivilDistrictMapFallback({
  context,
  party,
  showUserLocation,
}: {
  context: ElectoralDistrictContextResponse
  party: PartySummary | null
  showUserLocation: boolean
}) {
  const partyVisual = resolvePartyVisual(party)
  const districtPath = buildDistrictPath(context)
  const userPoint = context.district?.bounds
    ? projectPoint(context.userLocation.lng, context.userLocation.lat, context.district.bounds)
    : null

  return (
    <div className="absolute inset-0 overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.95),_rgba(226,232,240,0.92)_40%,_rgba(203,213,225,0.88)_100%)]">
      <svg viewBox={`0 0 ${FALLBACK_SIZE} ${FALLBACK_SIZE}`} className="h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="civil-district-fallback-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={partyVisual?.mapFillColor ?? '#d52b1e'} stopOpacity="0.32" />
            <stop offset="100%" stopColor={partyVisual?.mapLineColor ?? '#911e16'} stopOpacity="0.14" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={FALLBACK_SIZE} height={FALLBACK_SIZE} fill="rgba(248,250,252,0.92)" />
        <path
          d={districtPath ?? ''}
          fill="url(#civil-district-fallback-fill)"
          stroke={partyVisual?.mapLineColor ?? '#911e16'}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        {showUserLocation && userPoint ? (
          <>
            <circle cx={userPoint[0]} cy={userPoint[1]} r="11" fill="rgba(213, 43, 30, 0.18)" />
            <circle cx={userPoint[0]} cy={userPoint[1]} r="5.5" fill="#d52b1e" stroke="#ffffff" strokeWidth="2" />
          </>
        ) : null}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/88 via-white/52 to-transparent px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        District preview
      </div>
    </div>
  )
}

export function CivilDistrictMap({ context, party = null, showUserLocation = true }: CivilDistrictMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const [mapReady, setMapReady] = useState(false)

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn?.({ duration: 180 })
  }, [])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut?.({ duration: 180 })
  }, [])

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    let resizeTimeout: number | null = null
    let animationFrameId: number | null = null
    let readyTimeout: number | null = null

    setMapReady(false)

    void (async () => {
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return

      const container = containerRef.current

      const map = new maplibregl.Map({
        container,
        style: DISTRICT_MAP_STYLE as any,
        center: [context.userLocation.lng, context.userLocation.lat],
        zoom: 9,
        attributionControl: false,
      })
      mapRef.current = map
      const partyVisual = resolvePartyVisual(party)

      readyTimeout = window.setTimeout(() => {
        if (!cancelled) {
          setMapReady(false)
        }
      }, 2500)

      map.on('error', (event) => {
        setMapReady(false)
        console.error('CivilDistrictMap failed to render', event?.error ?? event)
      })

      const queueResize = () => {
        if (cancelled) return
        animationFrameId = window.requestAnimationFrame(() => {
          map.resize()
        })
      }

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          queueResize()
        })
        resizeObserver.observe(container)
      }

      queueResize()
      resizeTimeout = window.setTimeout(() => {
        map.resize()
      }, 120)

      map.on('load', () => {
        if (readyTimeout !== null) {
          window.clearTimeout(readyTimeout)
          readyTimeout = null
        }
        setMapReady(true)
        map.resize()

        if (showUserLocation) {
          const userFeature = {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [context.userLocation.lng, context.userLocation.lat] as [number, number],
            },
            properties: {},
          }

          map.addSource('civil-user-location', {
            type: 'geojson',
            data: userFeature,
          })

          map.addLayer({
            id: 'civil-user-location-ring',
            type: 'circle',
            source: 'civil-user-location',
            paint: {
              'circle-radius': 12,
              'circle-color': 'rgba(213, 43, 30, 0.18)',
            },
          })

          map.addLayer({
            id: 'civil-user-location-core',
            type: 'circle',
            source: 'civil-user-location',
            paint: {
              'circle-radius': 6,
              'circle-color': '#d52b1e',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          })
        }

        const bounds = context.district
          ? new maplibregl.LngLatBounds(
              [context.district.bounds[0], context.district.bounds[1]],
              [context.district.bounds[2], context.district.bounds[3]],
            )
          : new maplibregl.LngLatBounds(
              [context.userLocation.lng, context.userLocation.lat],
              [context.userLocation.lng, context.userLocation.lat],
            )

        if (showUserLocation) {
          bounds.extend([context.userLocation.lng, context.userLocation.lat])
        }

        if (context.district) {
          map.addSource('civil-district-boundary', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: context.district.geometry,
              properties: {
                code: context.district.code,
                name: context.district.name,
              },
            },
          })

          map.addLayer({
            id: 'civil-district-fill',
            type: 'fill',
            source: 'civil-district-boundary',
            paint: {
              'fill-color': partyVisual?.mapFillColor ?? '#d52b1e',
              'fill-opacity': partyVisual?.mapFillOpacity ?? 0.12,
            },
          })

          map.addLayer({
            id: 'civil-district-line',
            type: 'line',
            source: 'civil-district-boundary',
            paint: {
              'line-color': partyVisual?.mapLineColor ?? '#911e16',
              'line-width': 3,
            },
          })
        }

        map.fitBounds(bounds, {
          padding: 48,
          duration: 0,
          maxZoom: context.district ? 11 : 12,
        })
      })

      cleanup = () => {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId)
        }
        if (readyTimeout !== null) {
          window.clearTimeout(readyTimeout)
        }
        if (resizeTimeout !== null) {
          window.clearTimeout(resizeTimeout)
        }
        resizeObserver?.disconnect()
        map.remove()
        mapRef.current = null
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [context, party, showUserLocation])

  return (
    <div className="relative h-[360px] w-full overflow-hidden rounded-[24px] border border-[var(--cc-border)] bg-slate-100 shadow-subtle">
      {!mapReady ? <CivilDistrictMapFallback context={context} party={party} showUserLocation={showUserLocation} /> : null}
      <div ref={containerRef} className={`h-full w-full transition-opacity duration-300 ${mapReady ? 'opacity-100' : 'opacity-0'}`} />
      <MapZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
    </div>
  )
}
