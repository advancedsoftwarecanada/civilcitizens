'use client'

import { useEffect, useRef, useState } from 'react'

type MapPoint = {
  latitude: number
  longitude: number
  label: string
}

type ApproximatePickupMapProps = {
  location: MapPoint | null
}

const MAP_STYLE = {
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
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as const

export default function ApproximatePickupMap({ location }: ApproximatePickupMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const mapLibreRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false

    void (async () => {
      if (!containerRef.current || mapRef.current) return
      const maplibregl = await import('maplibre-gl')
      if (disposed || !containerRef.current) return

      mapLibreRef.current = maplibregl
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE as any,
        center: location ? [location.longitude, location.latitude] : [-79.3832, 43.6532],
        zoom: location ? 11.8 : 4,
        attributionControl: false,
      })

      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      map.on('load', () => {
        if (!disposed) setReady(true)
      })
      mapRef.current = map
    })()

    return () => {
      disposed = true
      markerRef.current?.remove?.()
      markerRef.current = null
      mapRef.current?.remove?.()
      mapRef.current = null
      mapLibreRef.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const mapLibre = mapLibreRef.current
    if (!map || !mapLibre || !location) return

    map.easeTo({ center: [location.longitude, location.latitude], zoom: 11.8, duration: 600 })

    if (!markerRef.current) {
      const element = document.createElement('div')
      element.className = 'relative h-10 w-10'
      element.innerHTML = [
        '<span class="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping"></span>',
        '<span class="absolute inset-[6px] rounded-full bg-emerald-500/25"></span>',
        '<span class="absolute inset-[11px] rounded-full border-2 border-white bg-emerald-600 shadow-[0_6px_18px_rgba(5,150,105,0.45)]"></span>',
      ].join('')
      markerRef.current = new mapLibre.Marker({ element, anchor: 'center' })
      markerRef.current.setLngLat([location.longitude, location.latitude])
      markerRef.current.addTo(map)
    }

    markerRef.current.setLngLat([location.longitude, location.latitude])
  }, [location, ready])

  return <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100" />
}