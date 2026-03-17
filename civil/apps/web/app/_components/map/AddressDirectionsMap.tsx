'use client'

import { useEffect, useRef } from 'react'

type MapPoint = {
  latitude: number
  longitude: number
  label: string
}

type AddressDirectionsMapProps = {
  destination: MapPoint | null
  origin?: MapPoint | null
  routeCoordinates?: Array<[number, number]> | null
}

const ADDRESS_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
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

export function AddressDirectionsMap({ destination, origin, routeCoordinates }: AddressDirectionsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      if (!containerRef.current || !destination) return
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: ADDRESS_MAP_STYLE as any,
        center: [destination.longitude, destination.latitude],
        zoom: origin ? 11 : 13,
        attributionControl: false,
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      map.on('load', () => {
        const features = [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [destination.longitude, destination.latitude] as [number, number],
            },
            properties: { kind: 'destination', label: destination.label },
          },
        ]

        if (origin) {
          features.push({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [origin.longitude, origin.latitude] as [number, number],
            },
            properties: { kind: 'origin', label: origin.label },
          })
        }

        map.addSource('address-points', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features,
          },
        })

        map.addLayer({
          id: 'address-point-rings',
          type: 'circle',
          source: 'address-points',
          paint: {
            'circle-radius': 14,
            'circle-color': ['match', ['get', 'kind'], 'origin', 'rgba(2, 132, 199, 0.18)', 'rgba(213, 43, 30, 0.18)'],
          },
        })

        map.addLayer({
          id: 'address-point-cores',
          type: 'circle',
          source: 'address-points',
          paint: {
            'circle-radius': 7,
            'circle-color': ['match', ['get', 'kind'], 'origin', '#0284c7', '#d52b1e'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        })

        if (origin) {
          const routeLineCoordinates = routeCoordinates?.length ? routeCoordinates : [
            [origin.longitude, origin.latitude],
            [destination.longitude, destination.latitude],
          ]

          map.addSource('address-route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeLineCoordinates,
              },
              properties: {},
            },
          })

          map.addLayer({
            id: 'address-route-line',
            type: 'line',
            source: 'address-route',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#0f172a',
              'line-width': 3,
              'line-opacity': 0.75,
              'line-dasharray': [2, 2],
            },
          })
        }

        const bounds = new maplibregl.LngLatBounds([destination.longitude, destination.latitude], [destination.longitude, destination.latitude])
        if (origin) bounds.extend([origin.longitude, origin.latitude])
        map.fitBounds(bounds, {
          padding: 72,
          duration: 0,
          maxZoom: origin ? 13 : 14,
        })
      })

      cleanup = () => map.remove()
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [destination, origin, routeCoordinates])

  return <div ref={containerRef} className="h-[420px] w-full overflow-hidden rounded-[28px] bg-slate-100 shadow-[0_20px_60px_rgba(15,23,42,0.08)]" />
}