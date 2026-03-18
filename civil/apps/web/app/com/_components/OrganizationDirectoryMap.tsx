'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CivilCard from '../../_components/CivilCard'
import { buildAddressesHref, buildAddressesHrefFromAddress } from '../../_lib/addressSearch'
import type { CanadianAddress } from '../../_lib/canadianAddresses'
import { MapZoomControls } from '../../_components/map/MapZoomControls'

type MapOrganization = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  logoUrl?: string | null
  coverUrl?: string | null
  address?: string | null
  addressDetails?: CanadianAddress | null
}

type Props = {
  organizations: MapOrganization[]
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
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
} as const

function appendSearchParamsToHref(href: string, params: Record<string, string | null | undefined>) {
  const [pathname, search = ''] = href.split('?')
  const nextParams = new URLSearchParams(search)
  Object.entries(params).forEach(([key, value]) => {
    const trimmed = value?.trim()
    if (trimmed) nextParams.set(key, trimmed)
  })
  const nextSearch = nextParams.toString()
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}`
}

function buildOrganizationDirectionsHref(org: MapOrganization) {
  if (org.addressDetails) {
    return appendSearchParamsToHref(buildAddressesHrefFromAddress(org.addressDetails, org.name), {
      organizationId: org.id,
      organizationName: org.name,
      organizationSlug: org.slug,
      organizationProvince: org.provinceCode?.toLowerCase() ?? null,
      organizationCommunity: org.communitySlug?.toLowerCase() ?? null,
      organizationLogo: org.logoUrl ?? null,
      organizationCover: org.coverUrl ?? null,
    })
  }

  if (org.address) {
    return appendSearchParamsToHref(
      buildAddressesHref({
        query: org.address,
        label: org.name,
        address: org.address,
      }),
      {
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        organizationProvince: org.provinceCode?.toLowerCase() ?? null,
        organizationCommunity: org.communitySlug?.toLowerCase() ?? null,
        organizationLogo: org.logoUrl ?? null,
        organizationCover: org.coverUrl ?? null,
      },
    )
  }

  return null
}

function getCoordinates(org: MapOrganization) {
  const latitude = typeof org.addressDetails?.latitude === 'number' ? org.addressDetails.latitude : null
  const longitude = typeof org.addressDetails?.longitude === 'number' ? org.addressDetails.longitude : null
  if (latitude === null || longitude === null) return null
  return { latitude, longitude }
}

export default function OrganizationDirectoryMap({ organizations }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const mapLibreRef = useRef<any>(null)
  const popupRef = useRef<any>(null)
  const popupRootRef = useRef<Root | null>(null)
  const markersRef = useRef<any[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)

  const mappedOrganizations = useMemo(
    () =>
      organizations
        .map((org) => {
          const coordinates = getCoordinates(org)
          return coordinates ? { ...org, coordinates } : null
        })
        .filter((entry): entry is MapOrganization & { coordinates: { latitude: number; longitude: number } } => Boolean(entry)),
    [organizations],
  )

  const selectedOrganization = useMemo(
    () => mappedOrganizations.find((org) => org.id === selectedOrgId) ?? null,
    [mappedOrganizations, selectedOrgId],
  )

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn?.({ duration: 180 })
  }, [])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut?.({ duration: 180 })
  }, [])

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return

      mapLibreRef.current = maplibregl
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE as any,
        center: [-79.3832, 43.6532],
        zoom: 9,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('load', () => setMapReady(true))
      map.on('click', () => setSelectedOrgId(null))

      cleanup = () => {
        markersRef.current.forEach((marker) => marker.remove())
        markersRef.current = []
        popupRootRef.current?.unmount()
        popupRootRef.current = null
        popupRef.current?.remove?.()
        popupRef.current = null
        map.remove()
        mapRef.current = null
        mapLibreRef.current = null
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const mapLibre = mapLibreRef.current
    if (!mapReady || !map || !mapLibre) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    if (!mappedOrganizations.length) return

    const bounds = new mapLibre.LngLatBounds(
      [mappedOrganizations[0]!.coordinates.longitude, mappedOrganizations[0]!.coordinates.latitude],
      [mappedOrganizations[0]!.coordinates.longitude, mappedOrganizations[0]!.coordinates.latitude],
    )

    mappedOrganizations.forEach((org) => {
      bounds.extend([org.coordinates.longitude, org.coordinates.latitude])

      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-rose-600 shadow-[0_4px_14px_rgba(225,29,72,0.45)]'
      element.innerHTML = '<span class="block h-2.5 w-2.5 rounded-full bg-white"></span>'
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        setSelectedOrgId(org.id)
      })

      const marker = new mapLibre.Marker({ element, anchor: 'center' }).setLngLat([org.coordinates.longitude, org.coordinates.latitude]).addTo(map)
      markersRef.current.push(marker)
    })

    map.fitBounds(bounds, {
      padding: 48,
      duration: 0,
      maxZoom: mappedOrganizations.length === 1 ? 14 : 11,
    })
  }, [mapReady, mappedOrganizations])

  useEffect(() => {
    const map = mapRef.current
    const mapLibre = mapLibreRef.current

    popupRootRef.current?.unmount()
    popupRootRef.current = null
    popupRef.current?.remove?.()
    popupRef.current = null

    if (!mapReady || !map || !mapLibre || !selectedOrganization) return

    const popupContainer = document.createElement('div')
    popupContainer.className = 'w-[296px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[28px]'
    const popup = new mapLibre.Popup({
      offset: 18,
      closeButton: false,
      className: 'civil-org-map-popup',
      maxWidth: '320px',
    })
      .setLngLat([selectedOrganization.coordinates.longitude, selectedOrganization.coordinates.latitude])
      .setDOMContent(popupContainer)
      .addTo(map)

    popup.on('close', () => setSelectedOrgId((current) => (current === selectedOrganization.id ? null : current)))

    const directionsHref = buildOrganizationDirectionsHref(selectedOrganization)
    const organizationHref =
      selectedOrganization.provinceCode && selectedOrganization.communitySlug
        ? `/com/${encodeURIComponent(selectedOrganization.provinceCode.toLowerCase())}/${encodeURIComponent(selectedOrganization.communitySlug.toLowerCase())}/orgs/${encodeURIComponent(selectedOrganization.slug)}`
        : undefined

    const root = createRoot(popupContainer)
    root.render(
      <div className="space-y-3 overflow-hidden rounded-[28px] bg-white p-1 shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
        <CivilCard
          size="md"
          name={selectedOrganization.name}
          avatarAlt={selectedOrganization.name}
          avatarInitials={selectedOrganization.name}
          avatarSrc={selectedOrganization.logoUrl ?? null}
          avatarHref={organizationHref}
          titleHref={organizationHref}
          coverUrl={selectedOrganization.coverUrl ?? null}
          subtitle="Organization"
          details={selectedOrganization.address ? <p className="break-words whitespace-normal leading-snug">{selectedOrganization.address}</p> : null}
          className="w-full"
          detailsClassName="text-white/90"
        />
        {directionsHref ? (
          <Link
            href={directionsHref}
            className="inline-flex w-full items-center justify-center rounded-full border border-rose-700 bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500"
          >
            Directions
          </Link>
        ) : null}
      </div>,
    )

    popupRef.current = popup
    popupRootRef.current = root
  }, [mapReady, selectedOrganization])

  if (!mappedOrganizations.length) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        No mapped organizations yet. Add an address with coordinates to place organizations on the community map.
      </div>
    )
  }

  return (
    <>
      <style jsx global>{`
        .civil-org-map-popup .maplibregl-popup-content {
          background: transparent;
          box-shadow: none;
          padding: 0;
          border-radius: 28px;
          overflow: hidden;
        }

        .civil-org-map-popup .maplibregl-popup-tip {
          border-top-color: rgba(255, 255, 255, 0.98);
          border-bottom-color: rgba(255, 255, 255, 0.98);
        }

        .civil-org-map-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,
        .civil-org-map-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,
        .civil-org-map-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip {
          border-top-color: rgba(255, 255, 255, 0.98);
        }

        .civil-org-map-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,
        .civil-org-map-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,
        .civil-org-map-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip {
          border-bottom-color: rgba(255, 255, 255, 0.98);
        }
      `}</style>
      <div className="relative h-[340px] w-full overflow-hidden rounded-[28px] border border-slate-200 bg-slate-100 shadow-subtle">
        <div ref={containerRef} className="h-full w-full" />
        <MapZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
      </div>
    </>
  )
}