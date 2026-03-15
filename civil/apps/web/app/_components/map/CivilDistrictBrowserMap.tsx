'use client'

import { useEffect, useRef, useState } from 'react'
import type { ElectoralDistrictBrowserResponse } from '@civil/shared'

type BrowserDistrict = ElectoralDistrictBrowserResponse['districts'][number]
type DistrictVisualStatus = 'default' | 'nearby' | 'following' | 'home'

type CivilDistrictBrowserMapProps = {
  browser: ElectoralDistrictBrowserResponse
  selectedDistrictCode: number | null
  selectedDistrict: BrowserDistrict | null
  districtStatusByCode: Record<number, DistrictVisualStatus>
  focusRequestToken: number
  isSelectedDistrictFollowing: boolean
  isSelectedDistrictHome: boolean
  isFollowPending: boolean
  onSelectDistrict: (districtCode: number) => void
  onFollowSelectedDistrict: () => void
}

function collectBounds(browser: ElectoralDistrictBrowserResponse) {
  const bounds = browser.districts.reduce<[number, number, number, number] | null>((acc, district) => {
    const [minLng, minLat, maxLng, maxLat] = district.bounds
    if (!acc) return [minLng, minLat, maxLng, maxLat]
    return [
      Math.min(acc[0], minLng),
      Math.min(acc[1], minLat),
      Math.max(acc[2], maxLng),
      Math.max(acc[3], maxLat),
    ]
  }, null)

  if (!bounds && browser.userLocation) {
    const { lng, lat } = browser.userLocation
    return [lng, lat, lng, lat] as [number, number, number, number]
  }

  return bounds
}

function resolveSelectedDistrict(args: {
  browser: ElectoralDistrictBrowserResponse
  selectedDistrictCode: number | null
  selectedDistrict: BrowserDistrict | null
}) {
  const fromCode = args.selectedDistrictCode ?? args.browser.selectedDistrictCode ?? args.browser.districts[0]?.code ?? null
  return args.selectedDistrict ?? args.browser.districts.find((district) => district.code === fromCode) ?? args.browser.districts[0] ?? null
}

function splitStatusCodes(districtStatusByCode: Record<number, DistrictVisualStatus>) {
  const homeCodes: number[] = []
  const followingCodes: number[] = []
  const nearbyCodes: number[] = []

  Object.entries(districtStatusByCode).forEach(([rawCode, status]) => {
    const code = Number(rawCode)
    if (!Number.isFinite(code)) return
    if (status === 'home') homeCodes.push(code)
    else if (status === 'following') followingCodes.push(code)
    else if (status === 'nearby') nearbyCodes.push(code)
  })

  return { homeCodes, followingCodes, nearbyCodes }
}

function buildDistrictFillOpacity(code: number) {
  const seeded = Math.abs(Math.sin(code * 12.9898) * 43758.5453)
  const fraction = seeded - Math.floor(seeded)
  return Number((0.5 + fraction * 0.25).toFixed(3))
}

function buildFillColorExpression(selectedCode: number | null, districtStatusByCode: Record<number, DistrictVisualStatus>) {
  const { homeCodes, followingCodes, nearbyCodes } = splitStatusCodes(districtStatusByCode)
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    [
      'case',
      ['in', ['get', 'code'], ['literal', homeCodes]],
      '#86efac',
      ['in', ['get', 'code'], ['literal', followingCodes]],
      '#93c5fd',
      ['in', ['get', 'code'], ['literal', nearbyCodes]],
      '#fdba74',
      '#d1d5db',
    ],
    [
      'case',
      ['in', ['get', 'code'], ['literal', homeCodes]],
      '#bbf7d0',
      ['in', ['get', 'code'], ['literal', followingCodes]],
      '#bfdbfe',
      ['in', ['get', 'code'], ['literal', nearbyCodes]],
      '#fed7aa',
      '#e5e7eb',
    ],
  ] as const
}

function buildFillOpacityExpression(selectedCode: number | null) {
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    1,
    ['coalesce', ['get', 'fillOpacity'], 0.5],
  ] as const
}

function buildLineColorExpression(selectedCode: number | null, districtStatusByCode: Record<number, DistrictVisualStatus>) {
  const { homeCodes, followingCodes, nearbyCodes } = splitStatusCodes(districtStatusByCode)
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    [
      'case',
      ['in', ['get', 'code'], ['literal', homeCodes]],
      '#16a34a',
      ['in', ['get', 'code'], ['literal', followingCodes]],
      '#2563eb',
      ['in', ['get', 'code'], ['literal', nearbyCodes]],
      '#ea580c',
      '#475569',
    ],
    [
      'case',
      ['in', ['get', 'code'], ['literal', homeCodes]],
      '#22c55e',
      ['in', ['get', 'code'], ['literal', followingCodes]],
      '#3b82f6',
      ['in', ['get', 'code'], ['literal', nearbyCodes]],
      '#f97316',
      '#94a3b8',
    ],
  ] as const
}

function buildLineWidthExpression(selectedCode: number | null) {
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    2.5,
    1.5,
  ] as const
}

function buildPopupContent(args: {
  district: BrowserDistrict
  isFollowing: boolean
  isHome: boolean
  isFollowPending: boolean
  visitHref: string
  onFollow: () => void
}) {
  const root = document.createElement('div')
  root.style.minWidth = '168px'
  root.style.maxWidth = '196px'
  root.style.borderRadius = '16px'
  root.style.background = 'rgba(255, 255, 255, 0.97)'
  root.style.padding = '10px 11px'
  root.style.color = '#0f172a'
  root.style.boxShadow = '0 16px 36px rgba(15, 23, 42, 0.18)'
  root.style.backdropFilter = 'blur(6px)'
  root.style.webkitBackdropFilter = 'blur(6px)'

  const headingRow = document.createElement('div')
  headingRow.style.display = 'flex'
  headingRow.style.alignItems = 'flex-start'
  headingRow.style.justifyContent = 'space-between'
  headingRow.style.gap = '8px'
  headingRow.style.marginTop = '1px'

  const title = document.createElement('div')
  title.style.fontSize = '13px'
  title.style.fontWeight = '700'
  title.style.lineHeight = '1.15'
  title.style.color = '#111827'
  title.textContent = args.district.name
  headingRow.appendChild(title)

  if (args.isHome || args.isFollowing) {
    const badge = document.createElement('span')
    badge.style.borderRadius = '999px'
    badge.style.padding = '3px 7px'
    badge.style.fontSize = '9px'
    badge.style.fontWeight = '700'
    badge.style.letterSpacing = '0.04em'
    badge.style.textTransform = 'uppercase'
    badge.style.whiteSpace = 'nowrap'
    badge.style.background = args.isHome ? '#dcfce7' : '#dbeafe'
    badge.style.color = args.isHome ? '#166534' : '#1d4ed8'
    badge.textContent = args.isHome ? 'Home' : 'Following'
    headingRow.appendChild(badge)
  }

  root.appendChild(headingRow)

  const stats = document.createElement('div')
  stats.style.display = 'flex'
  stats.style.alignItems = 'stretch'
  stats.style.gap = '10px'
  stats.style.marginTop = '7px'
  stats.style.paddingTop = '8px'
  stats.style.borderTop = '1px solid #e2e8f0'

  const followers = document.createElement('div')
  followers.style.minWidth = '0'
  followers.innerHTML = `<div style="font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;">Followers</div><div style="margin-top:2px;font-size:16px;font-weight:700;color:#111827;line-height:1;">${args.district.followerCount.toLocaleString()}</div>`
  stats.appendChild(followers)

  const postsToday = document.createElement('div')
  postsToday.style.minWidth = '0'
  postsToday.style.paddingLeft = '10px'
  postsToday.style.borderLeft = '1px solid #e2e8f0'
  postsToday.innerHTML = `<div style="font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;">Posts</div><div style="margin-top:2px;font-size:16px;font-weight:700;color:#111827;line-height:1;">${args.district.postsToday.toLocaleString()}</div>`
  stats.appendChild(postsToday)

  root.appendChild(stats)

  const actions = document.createElement('div')
  actions.style.display = 'flex'
  actions.style.alignItems = 'center'
  actions.style.gap = '6px'
  actions.style.marginTop = '9px'

  const visit = document.createElement('a')
  visit.href = args.visitHref
  visit.style.display = 'inline-flex'
  visit.style.alignItems = 'center'
  visit.style.justifyContent = 'center'
  visit.style.borderRadius = '999px'
  visit.style.border = '1px solid #cbd5e1'
  visit.style.padding = '5px 9px'
  visit.style.fontSize = '11px'
  visit.style.fontWeight = '600'
  visit.style.color = '#334155'
  visit.style.textDecoration = 'none'
  visit.textContent = 'Visit'
  actions.appendChild(visit)

  const follow = document.createElement('button')
  follow.type = 'button'
  follow.style.display = 'inline-flex'
  follow.style.alignItems = 'center'
  follow.style.justifyContent = 'center'
  follow.style.borderRadius = '999px'
  follow.style.padding = '5px 9px'
  follow.style.fontSize = '11px'
  follow.style.fontWeight = '700'
  follow.disabled = args.isHome || args.isFollowing || args.isFollowPending
  if (follow.disabled) {
    follow.style.border = '1px solid #e2e8f0'
    follow.style.color = '#94a3b8'
    follow.style.background = '#f8fafc'
  } else {
    follow.style.border = '1px solid #0f172a'
    follow.style.color = '#0f172a'
    follow.style.background = 'transparent'
  }
  follow.textContent = args.isHome ? 'Home' : args.isFollowing ? 'Following' : args.isFollowPending ? 'Following…' : 'Follow'
  follow.addEventListener('click', args.onFollow)
  actions.appendChild(follow)

  root.appendChild(actions)

  return root
}

export function CivilDistrictBrowserMap({
  browser,
  selectedDistrictCode,
  selectedDistrict,
  districtStatusByCode,
  focusRequestToken,
  isSelectedDistrictFollowing,
  isSelectedDistrictHome,
  isFollowPending,
  onSelectDistrict,
  onFollowSelectedDistrict,
}: CivilDistrictBrowserMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const maplibreRef = useRef<any>(null)
  const mapRef = useRef<any>(null)
  const popupRef = useRef<any>(null)
  const popupDismissedRef = useRef(false)
  const onSelectDistrictRef = useRef(onSelectDistrict)
  const onFollowSelectedDistrictRef = useRef(onFollowSelectedDistrict)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const selectionStateRef = useRef({
    selectedDistrictCode,
    selectedDistrict,
    districtStatusByCode,
    isSelectedDistrictFollowing,
    isSelectedDistrictHome,
    isFollowPending,
  })

  useEffect(() => {
    onSelectDistrictRef.current = onSelectDistrict
  }, [onSelectDistrict])

  useEffect(() => {
    onFollowSelectedDistrictRef.current = onFollowSelectedDistrict
  }, [onFollowSelectedDistrict])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenElement = document.fullscreenElement
      const nextIsFullscreen = Boolean(wrapperRef.current && fullscreenElement === wrapperRef.current)
      setIsFullscreen(nextIsFullscreen)
      mapRef.current?.resize()
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    selectionStateRef.current = {
      selectedDistrictCode,
      selectedDistrict,
      districtStatusByCode,
      isSelectedDistrictFollowing,
      isSelectedDistrictHome,
      isFollowPending,
    }
  }, [
    isFollowPending,
    isSelectedDistrictFollowing,
    isSelectedDistrictHome,
    districtStatusByCode,
    selectedDistrict,
    selectedDistrictCode,
  ])

  useEffect(() => {
    if (focusRequestToken > 0) {
      popupDismissedRef.current = false
    }
  }, [focusRequestToken])

  useEffect(() => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup || !map.isStyleLoaded()) return

    const resolvedDistrict = resolveSelectedDistrict({ browser, selectedDistrictCode, selectedDistrict })
    const selectedCode = resolvedDistrict?.code ?? null

    if (map.getLayer('civil-district-browser-fill')) {
      map.setPaintProperty('civil-district-browser-fill', 'fill-color', buildFillColorExpression(selectedCode, districtStatusByCode))
      map.setPaintProperty('civil-district-browser-fill', 'fill-opacity', buildFillOpacityExpression(selectedCode))
    }

    if (map.getLayer('civil-district-browser-line')) {
      map.setPaintProperty('civil-district-browser-line', 'line-color', buildLineColorExpression(selectedCode, districtStatusByCode))
      map.setPaintProperty('civil-district-browser-line', 'line-width', buildLineWidthExpression(selectedCode))
    }

    if (!resolvedDistrict || popupDismissedRef.current) {
      popup.remove()
      return
    }

    popup
      .setLngLat([resolvedDistrict.center.lng, resolvedDistrict.center.lat])
      .setDOMContent(
        buildPopupContent({
          district: resolvedDistrict,
          isFollowing: isSelectedDistrictFollowing,
          isHome: isSelectedDistrictHome,
          isFollowPending,
          visitHref: `/${resolvedDistrict.provinceCode.toLowerCase()}/${resolvedDistrict.slug.toLowerCase()}`,
          onFollow: () => onFollowSelectedDistrictRef.current(),
        }),
      )
      .addTo(map)

    if (focusRequestToken > 0) {
      const maplibregl = maplibreRef.current
      const districtBounds = resolvedDistrict.bounds
      if (maplibregl && Array.isArray(districtBounds)) {
        const bounds = new maplibregl.LngLatBounds([districtBounds[0], districtBounds[1]], [districtBounds[2], districtBounds[3]])
        map.fitBounds(bounds, {
          padding: 80,
          duration: 700,
          maxZoom: 10.5,
        })
      }
    }
  }, [
    browser,
    districtStatusByCode,
    focusRequestToken,
    isFollowPending,
    isSelectedDistrictFollowing,
    isSelectedDistrictHome,
    selectedDistrict,
    selectedDistrictCode,
  ])

  useEffect(() => {
    let cancelled = false
    popupDismissedRef.current = false

    void (async () => {
      const maplibregl = await import('maplibre-gl')
      maplibreRef.current = maplibregl
      if (cancelled || !containerRef.current) return

      const initialSelection = selectionStateRef.current
      const focusedDistrict = resolveSelectedDistrict({
        browser,
        selectedDistrictCode: initialSelection.selectedDistrictCode,
        selectedDistrict: initialSelection.selectedDistrict,
      })
      const selectedCode = focusedDistrict?.code ?? null

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: browser.styleUrl,
        center: focusedDistrict ? [focusedDistrict.center.lng, focusedDistrict.center.lat] : [browser.userLocation?.lng ?? -95, browser.userLocation?.lat ?? 56],
        zoom: focusedDistrict ? 8 : 4,
        attributionControl: false,
      })
      mapRef.current = map

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        className: 'civil-district-browser-popup',
        offset: 18,
        maxWidth: '300px',
      })
      popupRef.current = popup
      popup.on('close', () => {
        popupDismissedRef.current = true
      })

      map.on('load', () => {
        map.addSource('civil-district-browser', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: browser.districts.map((district) => ({
              type: 'Feature' as const,
              geometry: district.geometry,
              properties: {
                code: district.code,
                fillOpacity: buildDistrictFillOpacity(district.code),
                name: district.name,
                slug: district.slug,
                provinceCode: district.provinceCode,
              },
            })),
          },
        })

        map.addLayer({
          id: 'civil-district-browser-fill',
          type: 'fill',
          source: 'civil-district-browser',
          paint: {
            'fill-color': buildFillColorExpression(selectedCode, initialSelection.districtStatusByCode),
            'fill-opacity': buildFillOpacityExpression(selectedCode),
          },
        })

        map.addLayer({
          id: 'civil-district-browser-line',
          type: 'line',
          source: 'civil-district-browser',
          paint: {
            'line-color': buildLineColorExpression(selectedCode, initialSelection.districtStatusByCode),
            'line-width': buildLineWidthExpression(selectedCode),
          },
        })

        if (browser.userLocation) {
          map.addSource('civil-browser-user-location', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [browser.userLocation.lng, browser.userLocation.lat],
              },
              properties: {},
            },
          })

          map.addLayer({
            id: 'civil-browser-user-location-ring',
            type: 'circle',
            source: 'civil-browser-user-location',
            paint: {
              'circle-radius': 12,
              'circle-color': 'rgba(213, 43, 30, 0.18)',
            },
          })

          map.addLayer({
            id: 'civil-browser-user-location-core',
            type: 'circle',
            source: 'civil-browser-user-location',
            paint: {
              'circle-radius': 6,
              'circle-color': '#d52b1e',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          })
        }

        if (focusedDistrict) {
          const districtBounds = new maplibregl.LngLatBounds(
            [focusedDistrict.bounds[0], focusedDistrict.bounds[1]],
            [focusedDistrict.bounds[2], focusedDistrict.bounds[3]],
          )
          map.fitBounds(districtBounds, {
            padding: 80,
            duration: 0,
            maxZoom: 10.5,
          })
        } else {
          const fitTarget = collectBounds(browser)
          if (fitTarget) {
            const bounds = new maplibregl.LngLatBounds([fitTarget[0], fitTarget[1]], [fitTarget[2], fitTarget[3]])
            if (browser.userLocation) {
              bounds.extend([browser.userLocation.lng, browser.userLocation.lat])
            }
            map.fitBounds(bounds, {
              padding: 48,
              duration: 0,
              maxZoom: 7,
            })
          }
        }

        const nextSelection = selectionStateRef.current
        const resolvedDistrict = resolveSelectedDistrict({
          browser,
          selectedDistrictCode: nextSelection.selectedDistrictCode,
          selectedDistrict: nextSelection.selectedDistrict,
        })
        if (resolvedDistrict) {
          popup
            .setLngLat([resolvedDistrict.center.lng, resolvedDistrict.center.lat])
            .setDOMContent(
              buildPopupContent({
                district: resolvedDistrict,
                isFollowing: nextSelection.isSelectedDistrictFollowing,
                isHome: nextSelection.isSelectedDistrictHome,
                isFollowPending: nextSelection.isFollowPending,
                visitHref: `/${resolvedDistrict.provinceCode.toLowerCase()}/${resolvedDistrict.slug.toLowerCase()}`,
                onFollow: () => onFollowSelectedDistrictRef.current(),
              }),
            )
            .addTo(map)
        }
      })

      const handleDistrictClick = (event: any) => {
        const code = Number(event.features?.[0]?.properties?.code)
        if (Number.isFinite(code)) {
          popupDismissedRef.current = false
          onSelectDistrictRef.current(code)
        }
      }

      map.on('click', 'civil-district-browser-fill', handleDistrictClick)
      map.on('click', 'civil-district-browser-line', handleDistrictClick)
      map.on('mouseenter', 'civil-district-browser-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'civil-district-browser-fill', () => {
        map.getCanvas().style.cursor = ''
      })

    })()

    return () => {
      cancelled = true
      popupRef.current?.remove()
      popupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      maplibreRef.current = null
    }
  }, [browser])

  async function handleToggleFullscreen() {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    if (document.fullscreenElement === wrapper) {
      await document.exitFullscreen().catch(() => undefined)
      return
    }

    await wrapper.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <>
      <style jsx global>{`
        .civil-district-browser-popup .maplibregl-popup-content {
          background: transparent;
          box-shadow: none;
          padding: 0;
        }

        .civil-district-browser-popup .maplibregl-popup-tip {
          border-top-color: rgba(255, 255, 255, 0.96);
          border-bottom-color: rgba(255, 255, 255, 0.96);
        }

        .civil-district-browser-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,
        .civil-district-browser-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,
        .civil-district-browser-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip {
          border-top-color: rgba(255, 255, 255, 0.96);
        }

        .civil-district-browser-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,
        .civil-district-browser-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,
        .civil-district-browser-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip {
          border-bottom-color: rgba(255, 255, 255, 0.96);
        }

        .civil-district-browser-popup .maplibregl-popup-close-button {
          right: 6px;
          top: 4px;
          color: #94a3b8;
          font-size: 16px;
          line-height: 1;
          padding: 2px 6px;
          background: transparent;
          border: 0;
        }

        .civil-district-browser-popup .maplibregl-popup-close-button:hover {
          color: #475569;
          background: transparent;
        }
      `}</style>
      <div ref={wrapperRef} className="relative h-[460px] w-full overflow-hidden rounded-[24px] border border-[var(--cc-border)] bg-slate-100 shadow-subtle">
        <button
          type="button"
          className="absolute left-4 top-4 z-10 inline-flex items-center justify-center rounded-full border border-slate-300/90 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-sm transition hover:bg-white"
          onClick={() => {
            void handleToggleFullscreen()
          }}
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </>
  )
}