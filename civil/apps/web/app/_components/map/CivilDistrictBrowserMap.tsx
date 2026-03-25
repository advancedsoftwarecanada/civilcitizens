'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ElectoralDistrictBrowserResponse } from '@civil/shared'
import { MapZoomControls } from './MapZoomControls'

type BrowserDistrict = ElectoralDistrictBrowserResponse['districts'][number]
type DistrictVisualStatus = 'default' | 'nearby' | 'following' | 'home'
type DistrictParty = BrowserDistrict['party']
type DistrictPartyStatus = BrowserDistrict['partyStatus']
type PopupMode = 'default' | 'politicalExplorer'
type DistrictPalette = {
  fillColor: string
  selectedFillColor: string
  lineColor: string
  selectedLineColor: string
  fillOpacity: number
  selectedFillOpacity: number
  stripeColor: string | null
  selectedStripeColor: string | null
}

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
  onToggleSelectedDistrictFollow: () => void
  showFollowAction?: boolean
  visitHrefBuilder?: (district: BrowserDistrict) => string
  allowEmptySelection?: boolean
  popupMode?: PopupMode
  visitLabel?: string
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
  allowEmptySelection?: boolean
}) {
  if (args.selectedDistrict) return args.selectedDistrict

  const fromCode = args.selectedDistrictCode ?? args.browser.selectedDistrictCode ?? null
  if (fromCode == null) {
    return args.allowEmptySelection ? null : args.browser.districts[0] ?? null
  }

  return args.browser.districts.find((district) => district.code === fromCode) ?? (args.allowEmptySelection ? null : args.browser.districts[0] ?? null)
}

function buildStripePatternId(color: string) {
  return `civil-district-stripe-${color.replace('#', '').toLowerCase()}`
}

function buildStripeImageData(color: string) {
  const size = 12
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return null

  context.clearRect(0, 0, size, size)
  context.strokeStyle = color
  context.lineWidth = 2

  for (let offset = -size; offset <= size * 2; offset += 6) {
    context.beginPath()
    context.moveTo(offset, size)
    context.lineTo(offset + size, 0)
    context.stroke()
  }

  return context.getImageData(0, 0, size, size)
}

function ensureStripePattern(map: any, color: string | null) {
  if (!color) return null
  const patternId = buildStripePatternId(color)
  if (map.hasImage(patternId)) return patternId

  const imageData = buildStripeImageData(color)
  if (!imageData) return null

  map.addImage(patternId, imageData, { pixelRatio: 2 })
  return patternId
}

function resolveDistrictPalette(party: DistrictParty, partyStatus: DistrictPartyStatus): DistrictPalette {
  const partySlug = party?.slug?.trim().toLowerCase() ?? ''
  const hasSeat = partyStatus === 'seat'
  const hasRegisteredAssociation = partyStatus === 'registered'

  if (partySlug === 'liberal-party-of-canada') {
    return {
      fillColor: hasRegisteredAssociation ? '#e2e8f0' : '#ef4444',
      selectedFillColor: hasRegisteredAssociation ? '#cbd5e1' : '#dc2626',
      lineColor: '#b91c1c',
      selectedLineColor: '#991b1b',
      fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
      selectedFillOpacity: 0.88,
      stripeColor: hasRegisteredAssociation ? '#dc2626' : null,
      selectedStripeColor: hasRegisteredAssociation ? '#b91c1c' : null,
    }
  }

  if (partySlug === 'conservative-party-of-canada') {
    return {
      fillColor: hasRegisteredAssociation ? '#e2e8f0' : '#2563eb',
      selectedFillColor: hasRegisteredAssociation ? '#cbd5e1' : '#1d4ed8',
      lineColor: '#1e40af',
      selectedLineColor: '#1e3a8a',
      fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
      selectedFillOpacity: 0.88,
      stripeColor: hasRegisteredAssociation ? '#2563eb' : null,
      selectedStripeColor: hasRegisteredAssociation ? '#1d4ed8' : null,
    }
  }

  if (partySlug === 'new-democratic-party') {
    return {
      fillColor: hasRegisteredAssociation ? '#e2e8f0' : '#f97316',
      selectedFillColor: hasRegisteredAssociation ? '#cbd5e1' : '#ea580c',
      lineColor: '#c2410c',
      selectedLineColor: '#9a3412',
      fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
      selectedFillOpacity: 0.88,
      stripeColor: hasRegisteredAssociation ? '#ea580c' : null,
      selectedStripeColor: hasRegisteredAssociation ? '#c2410c' : null,
    }
  }

  if (partySlug === 'green-party-of-canada') {
    return {
      fillColor: hasRegisteredAssociation ? '#e2e8f0' : '#22c55e',
      selectedFillColor: hasRegisteredAssociation ? '#cbd5e1' : '#16a34a',
      lineColor: '#15803d',
      selectedLineColor: '#166534',
      fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
      selectedFillOpacity: 0.88,
      stripeColor: hasRegisteredAssociation ? '#16a34a' : null,
      selectedStripeColor: hasRegisteredAssociation ? '#15803d' : null,
    }
  }

  if (partySlug === 'bloc-quebecois') {
    return {
      fillColor: hasRegisteredAssociation ? '#e2e8f0' : '#38bdf8',
      selectedFillColor: hasRegisteredAssociation ? '#cbd5e1' : '#0ea5e9',
      lineColor: '#0284c7',
      selectedLineColor: '#0369a1',
      fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
      selectedFillOpacity: 0.88,
      stripeColor: hasRegisteredAssociation ? '#0ea5e9' : null,
      selectedStripeColor: hasRegisteredAssociation ? '#0284c7' : null,
    }
  }

  if (partySlug === 'peoples-party-of-canada') {
    return {
      fillColor: hasRegisteredAssociation ? '#e2e8f0' : '#8b5cf6',
      selectedFillColor: hasRegisteredAssociation ? '#cbd5e1' : '#7c3aed',
      lineColor: '#6d28d9',
      selectedLineColor: '#5b21b6',
      fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
      selectedFillOpacity: 0.88,
      stripeColor: hasRegisteredAssociation ? '#7c3aed' : null,
      selectedStripeColor: hasRegisteredAssociation ? '#6d28d9' : null,
    }
  }

  return {
    fillColor: hasSeat ? '#94a3b8' : '#cbd5e1',
    selectedFillColor: hasSeat ? '#64748b' : '#94a3b8',
    lineColor: hasSeat || hasRegisteredAssociation ? '#64748b' : '#94a3b8',
    selectedLineColor: '#475569',
    fillOpacity: hasRegisteredAssociation ? 0.86 : 0.64,
    selectedFillOpacity: 0.84,
    stripeColor: hasRegisteredAssociation ? '#64748b' : null,
    selectedStripeColor: hasRegisteredAssociation ? '#475569' : null,
  }
}

function resolvePartyLabel(party: DistrictParty) {
  if (!party) return null
  return party.shortName?.trim() || party.name
}

function buildFillColorExpression(selectedCode: number | null) {
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    ['coalesce', ['get', 'selectedFillColor'], ['get', 'fillColor'], '#94a3b8'],
    ['coalesce', ['get', 'fillColor'], '#cbd5e1'],
  ]
}

function buildFillOpacityExpression(selectedCode: number | null) {
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    ['coalesce', ['get', 'selectedFillOpacity'], 0.88],
    ['coalesce', ['get', 'fillOpacity'], 0.5],
  ]
}

function buildPatternFilter(selectedCode: number | null, selectedOnly: boolean) {
  return [
    'all',
    ['==', ['get', 'hasPattern'], 1],
    selectedOnly
      ? ['==', ['get', 'code'], selectedCode ?? -1]
      : ['!=', ['get', 'code'], selectedCode ?? -1],
  ]
}

function buildLineColorExpression(selectedCode: number | null) {
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    ['coalesce', ['get', 'selectedLineColor'], ['get', 'lineColor'], '#64748b'],
    ['coalesce', ['get', 'lineColor'], '#94a3b8'],
  ]
}

function buildLineWidthExpression(selectedCode: number | null) {
  return [
    'case',
    ['==', ['get', 'code'], selectedCode ?? -1],
    2.5,
    1.5,
  ]
}

function buildPartyHref(slug: string) {
  return `/politicians/federal/${encodeURIComponent(slug)}`
}

function createPartyLink(args: {
  slug: string
  label: string
  color: string
  marginTop?: string
  fontSize?: string
}) {
  const link = document.createElement('a')
  link.href = buildPartyHref(args.slug)
  link.style.display = 'inline-flex'
  link.style.marginTop = args.marginTop ?? '5px'
  link.style.fontSize = args.fontSize ?? '11px'
  link.style.fontWeight = '600'
  link.style.lineHeight = '1.3'
  link.style.color = args.color
  link.style.textDecoration = 'none'
  link.textContent = args.label
  link.addEventListener('mouseenter', () => {
    link.style.textDecoration = 'underline'
  })
  link.addEventListener('mouseleave', () => {
    link.style.textDecoration = 'none'
  })
  return link
}

function createMemberRow(args: {
  displayName: string
  photoUrl: string | null
  subtitle: string
  marginTop?: string
}) {
  const memberRow = document.createElement('div')
  memberRow.style.display = 'flex'
  memberRow.style.alignItems = 'center'
  memberRow.style.gap = '10px'
  memberRow.style.marginTop = args.marginTop ?? '6px'

  const avatar = document.createElement(args.photoUrl ? 'img' : 'div')
  avatar.style.width = '42px'
  avatar.style.height = '42px'
  avatar.style.flexShrink = '0'
  avatar.style.borderRadius = '999px'
  avatar.style.border = '1px solid #e2e8f0'
  avatar.style.background = '#f8fafc'
  if (avatar instanceof HTMLImageElement && args.photoUrl) {
    avatar.src = args.photoUrl
    avatar.alt = args.displayName
    avatar.loading = 'lazy'
    avatar.style.objectFit = 'cover'
  } else {
    avatar.style.display = 'flex'
    avatar.style.alignItems = 'center'
    avatar.style.justifyContent = 'center'
    avatar.style.fontSize = '14px'
    avatar.style.fontWeight = '700'
    avatar.style.color = '#64748b'
    avatar.textContent = args.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'MP'
  }
  memberRow.appendChild(avatar)

  const memberText = document.createElement('div')
  memberText.style.minWidth = '0'

  const memberName = document.createElement('div')
  memberName.style.fontSize = '13px'
  memberName.style.fontWeight = '700'
  memberName.style.lineHeight = '1.25'
  memberName.style.color = '#111827'
  memberName.textContent = args.displayName
  memberText.appendChild(memberName)

  const memberTitle = document.createElement('div')
  if (args.subtitle.trim()) {
    memberTitle.style.marginTop = '2px'
    memberTitle.style.fontSize = '10px'
    memberTitle.style.fontWeight = '600'
    memberTitle.style.letterSpacing = '0.08em'
    memberTitle.style.textTransform = 'uppercase'
    memberTitle.style.color = '#64748b'
    memberTitle.textContent = args.subtitle
    memberText.appendChild(memberTitle)
  }

  memberRow.appendChild(memberText)
  return memberRow
}

function areSameRepresentative(
  activeSeatPolitician: { slug: string; displayName: string } | null | undefined,
  selectedPartyPolitician: BrowserDistrict['selectedPartyPolitician'],
) {
  if (!activeSeatPolitician || !selectedPartyPolitician) return false

  if (activeSeatPolitician.slug && selectedPartyPolitician.slug) {
    return activeSeatPolitician.slug === selectedPartyPolitician.slug
  }

  return activeSeatPolitician.displayName.trim().toLowerCase() === selectedPartyPolitician.displayName.trim().toLowerCase()
}

function buildPopupContent(args: {
  district: BrowserDistrict
  isFollowing: boolean
  isHome: boolean
  isFollowPending: boolean
  visitHref: string
  onToggleFollow: () => void
  showFollowAction: boolean
  popupMode: PopupMode
  visitLabel: string
}) {
  const root = document.createElement('div')
  root.style.minWidth = args.popupMode === 'politicalExplorer' ? '220px' : '168px'
  root.style.maxWidth = args.popupMode === 'politicalExplorer' ? '252px' : '196px'
  root.style.borderRadius = '16px'
  root.style.background = 'rgba(255, 255, 255, 0.97)'
  root.style.padding = '10px 11px'
  root.style.color = '#0f172a'
  root.style.boxShadow = '0 16px 36px rgba(15, 23, 42, 0.18)'
  root.style.backdropFilter = 'blur(6px)'
  root.style.setProperty('-webkit-backdrop-filter', 'blur(6px)')

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

  const partyLabel = resolvePartyLabel(args.district.party)
  const partyPalette = resolveDistrictPalette(args.district.party, args.district.partyStatus)
  if (args.popupMode !== 'politicalExplorer' && partyLabel) {
    const party = args.district.party
      ? createPartyLink({
          slug: args.district.party.slug,
          label: partyLabel,
          color: partyPalette.selectedLineColor,
        })
      : document.createElement('div')
    if (!(party instanceof HTMLAnchorElement)) {
      party.style.marginTop = '5px'
      party.style.fontSize = '11px'
      party.style.fontWeight = '600'
      party.style.color = partyPalette.selectedLineColor
      party.textContent = partyLabel
    }
    root.appendChild(party)

    if (args.district.partyStatus === 'registered') {
      const status = document.createElement('div')
      status.style.marginTop = '2px'
      status.style.fontSize = '10px'
      status.style.fontWeight = '600'
      status.style.letterSpacing = '0.08em'
      status.style.textTransform = 'uppercase'
      status.style.color = '#64748b'
      status.textContent = 'Registered association'
      root.appendChild(status)
    }
  }

  if (args.popupMode === 'politicalExplorer') {
    const activeSeat = args.district.activeSeat
    const selectedPartyPolitician = args.district.selectedPartyPolitician
    const shouldShowSelectedPartyPolitician = Boolean(
      args.district.partyStatus === 'registered'
        && args.district.party
        && (!activeSeat?.politician || !areSameRepresentative(activeSeat.politician, selectedPartyPolitician)),
    )
    if (activeSeat?.party || activeSeat?.politician) {
      const seatWrap = document.createElement('div')
      seatWrap.style.marginTop = '8px'
      seatWrap.style.paddingTop = '8px'
      seatWrap.style.borderTop = '1px solid #e2e8f0'

      const seatLabel = document.createElement('div')
      seatLabel.style.fontSize = '9px'
      seatLabel.style.fontWeight = '700'
      seatLabel.style.letterSpacing = '0.18em'
      seatLabel.style.textTransform = 'uppercase'
      seatLabel.style.color = '#94a3b8'
      seatLabel.textContent = 'Active Seat'
      seatWrap.appendChild(seatLabel)

      if (activeSeat.party) {
        const activeSeatPalette = resolveDistrictPalette(activeSeat.party, 'seat')
        const activeParty = createPartyLink({
          slug: activeSeat.party.slug,
          label: activeSeat.party.name,
          color: activeSeatPalette.selectedLineColor,
          marginTop: '5px',
          fontSize: '12px',
        })
        seatWrap.appendChild(activeParty)
      }

      if (activeSeat.politician) {
        seatWrap.appendChild(
          createMemberRow({
            displayName: activeSeat.politician.displayName,
            photoUrl: activeSeat.politician.photoUrl,
            subtitle: activeSeat.title,
            marginTop: activeSeat.party ? '8px' : '6px',
          }),
        )
      }

      root.appendChild(seatWrap)
    }

    if (shouldShowSelectedPartyPolitician && args.district.party) {
      const selectedMemberWrap = document.createElement('div')
      selectedMemberWrap.style.marginTop = '8px'
      selectedMemberWrap.style.paddingTop = '8px'
      selectedMemberWrap.style.borderTop = '1px solid #e2e8f0'

      const selectedMemberLabel = document.createElement('div')
      selectedMemberLabel.style.marginTop = '1px'
      selectedMemberLabel.style.fontSize = '12px'
      selectedMemberLabel.style.fontWeight = '700'
      selectedMemberLabel.style.lineHeight = '1.3'
      selectedMemberLabel.style.color = '#111827'
      selectedMemberLabel.textContent = ''
      selectedMemberWrap.appendChild(selectedMemberLabel)

      const selectedPartyLink = createPartyLink({
        slug: args.district.party.slug,
        label: `${args.district.party.name} Registered Seat`,
        color: partyPalette.selectedLineColor,
        marginTop: '0px',
        fontSize: '12px',
      })
      selectedMemberWrap.replaceChild(selectedPartyLink, selectedMemberLabel)

      if (selectedPartyPolitician) {
        selectedMemberWrap.appendChild(
          createMemberRow({
            displayName: selectedPartyPolitician.displayName,
            photoUrl: selectedPartyPolitician.photoUrl,
            subtitle: '',
            marginTop: '6px',
          }),
        )
      }

      root.appendChild(selectedMemberWrap)
    }
  } else {
    const stats = document.createElement('div')
    stats.style.display = 'flex'
    stats.style.alignItems = 'stretch'
    stats.style.gap = '10px'
    stats.style.marginTop = partyLabel ? '8px' : '7px'
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
  }

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
  visit.textContent = args.visitLabel
  actions.appendChild(visit)

  if (args.showFollowAction) {
    const follow = document.createElement('button')
    follow.type = 'button'
    follow.style.display = 'inline-flex'
    follow.style.alignItems = 'center'
    follow.style.justifyContent = 'center'
    follow.style.borderRadius = '999px'
    follow.style.padding = '5px 9px'
    follow.style.fontSize = '11px'
    follow.style.fontWeight = '700'
    follow.disabled = args.isHome || args.isFollowPending
    if (follow.disabled) {
      follow.style.border = '1px solid #e2e8f0'
      follow.style.color = '#94a3b8'
      follow.style.background = '#f8fafc'
    } else if (args.isFollowing) {
      follow.style.border = '1px solid #dc2626'
      follow.style.color = '#dc2626'
      follow.style.background = '#fef2f2'
    } else {
      follow.style.border = '1px solid #0f172a'
      follow.style.color = '#0f172a'
      follow.style.background = 'transparent'
    }
    follow.textContent = args.isHome ? 'Home' : args.isFollowPending ? (args.isFollowing ? 'Unfollowing…' : 'Following…') : args.isFollowing ? 'Unfollow' : 'Follow'
    follow.addEventListener('click', args.onToggleFollow)
    actions.appendChild(follow)
  }

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
  onToggleSelectedDistrictFollow,
  showFollowAction = true,
  visitHrefBuilder,
  allowEmptySelection = false,
  popupMode = 'default',
  visitLabel = 'Visit',
}: CivilDistrictBrowserMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const maplibreRef = useRef<any>(null)
  const mapRef = useRef<any>(null)
  const popupRef = useRef<any>(null)
  const popupDismissedRef = useRef(false)
  const onSelectDistrictRef = useRef(onSelectDistrict)
  const onToggleSelectedDistrictFollowRef = useRef(onToggleSelectedDistrictFollow)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const selectionStateRef = useRef({
    selectedDistrictCode,
    selectedDistrict,
    districtStatusByCode,
    isSelectedDistrictFollowing,
    isSelectedDistrictHome,
    isFollowPending,
  })

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn?.({ duration: 180 })
  }, [])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut?.({ duration: 180 })
  }, [])

  useEffect(() => {
    onSelectDistrictRef.current = onSelectDistrict
  }, [onSelectDistrict])

  useEffect(() => {
    onToggleSelectedDistrictFollowRef.current = onToggleSelectedDistrictFollow
  }, [onToggleSelectedDistrictFollow])

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

    const resolvedDistrict = resolveSelectedDistrict({ browser, selectedDistrictCode, selectedDistrict, allowEmptySelection })
    const selectedCode = resolvedDistrict?.code ?? null

    if (map.getLayer('civil-district-browser-fill')) {
      map.setPaintProperty('civil-district-browser-fill', 'fill-color', buildFillColorExpression(selectedCode))
      map.setPaintProperty('civil-district-browser-fill', 'fill-opacity', buildFillOpacityExpression(selectedCode))
    }

    if (map.getLayer('civil-district-browser-pattern')) {
      map.setFilter('civil-district-browser-pattern', buildPatternFilter(selectedCode, false) as any)
    }

    if (map.getLayer('civil-district-browser-pattern-selected')) {
      map.setFilter('civil-district-browser-pattern-selected', buildPatternFilter(selectedCode, true) as any)
    }

    if (map.getLayer('civil-district-browser-line')) {
      map.setPaintProperty('civil-district-browser-line', 'line-color', buildLineColorExpression(selectedCode))
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
          visitHref: visitHrefBuilder ? visitHrefBuilder(resolvedDistrict) : `/${resolvedDistrict.provinceCode.toLowerCase()}/${resolvedDistrict.slug.toLowerCase()}`,
          onToggleFollow: () => onToggleSelectedDistrictFollowRef.current(),
          showFollowAction,
          popupMode,
          visitLabel,
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
    showFollowAction,
    popupMode,
    visitLabel,
    visitHrefBuilder,
    allowEmptySelection,
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
        allowEmptySelection,
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
        browser.districts.forEach((district) => {
          const palette = resolveDistrictPalette(district.party, district.partyStatus)
          ensureStripePattern(map, palette.stripeColor)
          ensureStripePattern(map, palette.selectedStripeColor)
        })

        map.addSource('civil-district-browser', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: browser.districts.map((district) => {
              const palette = resolveDistrictPalette(district.party, district.partyStatus)
              const patternId = palette.stripeColor ? buildStripePatternId(palette.stripeColor) : null
              const selectedPatternId = palette.selectedStripeColor ? buildStripePatternId(palette.selectedStripeColor) : null
              return {
                type: 'Feature' as const,
                geometry: district.geometry,
                properties: {
                  code: district.code,
                  fillColor: palette.fillColor,
                  selectedFillColor: palette.selectedFillColor,
                  lineColor: palette.lineColor,
                  selectedLineColor: palette.selectedLineColor,
                  fillOpacity: palette.fillOpacity,
                  selectedFillOpacity: palette.selectedFillOpacity,
                  hasPattern: patternId ? 1 : 0,
                  patternId,
                  selectedPatternId,
                  name: district.name,
                  slug: district.slug,
                  provinceCode: district.provinceCode,
                },
              }
            }),
          },
        })

        map.addLayer({
          id: 'civil-district-browser-fill',
          type: 'fill',
          source: 'civil-district-browser',
          paint: {
            'fill-color': buildFillColorExpression(selectedCode) as any,
            'fill-opacity': buildFillOpacityExpression(selectedCode) as any,
          },
        })

        map.addLayer({
          id: 'civil-district-browser-pattern',
          type: 'fill',
          source: 'civil-district-browser',
          filter: buildPatternFilter(selectedCode, false) as any,
          paint: {
            'fill-pattern': ['get', 'patternId'] as any,
          },
        })

        map.addLayer({
          id: 'civil-district-browser-pattern-selected',
          type: 'fill',
          source: 'civil-district-browser',
          filter: buildPatternFilter(selectedCode, true) as any,
          paint: {
            'fill-pattern': ['get', 'selectedPatternId'] as any,
          },
        })

        map.addLayer({
          id: 'civil-district-browser-line',
          type: 'line',
          source: 'civil-district-browser',
          paint: {
            'line-color': buildLineColorExpression(selectedCode) as any,
            'line-width': buildLineWidthExpression(selectedCode) as any,
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
          allowEmptySelection,
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
                visitHref: visitHrefBuilder ? visitHrefBuilder(resolvedDistrict) : `/${resolvedDistrict.provinceCode.toLowerCase()}/${resolvedDistrict.slug.toLowerCase()}`,
                onToggleFollow: () => onToggleSelectedDistrictFollowRef.current(),
                showFollowAction,
                popupMode,
                visitLabel,
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
      map.on('click', 'civil-district-browser-pattern', handleDistrictClick)
      map.on('click', 'civil-district-browser-pattern-selected', handleDistrictClick)
      map.on('click', 'civil-district-browser-line', handleDistrictClick)
      map.on('mouseenter', 'civil-district-browser-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseenter', 'civil-district-browser-pattern', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseenter', 'civil-district-browser-pattern-selected', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'civil-district-browser-fill', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseleave', 'civil-district-browser-pattern', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseleave', 'civil-district-browser-pattern-selected', () => {
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
  }, [browser, showFollowAction, popupMode, visitLabel, visitHrefBuilder, allowEmptySelection])

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
        <MapZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} className="top-16" />
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </>
  )
}
