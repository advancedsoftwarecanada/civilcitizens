'use client'

export const DELIVERY_BID_OPTIONS = [500, 1000, 2000, 5000, 10000] as const

export type DeliveryRequirementMap = {
  walletReady: boolean
  isCanadianCitizen: boolean
  hasProfilePhoto: boolean
  hasHomeAddress: boolean
}

export type DeliveryOnboardingResponse = {
  active?: boolean
  activeAt?: string | null
  requirements?: Partial<DeliveryRequirementMap> | null
}

export type DeliveryOpenContract = {
  id: string
  status: string
  listingId: string
  listingTitle: string
  listingPhotoUrl: string | null
  pickupAddressLabel?: string | null
  dropoffAddressLabel?: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupInstructions: string | null
  itemTraits: string[]
  bidPending: boolean
  bidDriverUserId: string | null
  bidAmountCents: number | null
  bidPerKmFeeCents?: number | null
  distanceKm: number | null
  routeDistanceKm?: number | null
  isBidByViewer?: boolean
  seller: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  buyer: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
}

export type DeliveryDriverContract = {
  id: string
  status: string
  listingId: string
  listingTitle: string
  listingPhotoUrl: string | null
  pickupAddressLabel?: string | null
  dropoffAddressLabel?: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupInstructions: string | null
  itemTraits: string[]
  bidAmountCents: number | null
  bidPerKmFeeCents?: number | null
  acceptedAt?: string | null
  estimatedDeliveryAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  deliveryPhotoUrl?: string | null
  groupThreadId: string | null
  buyer: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  seller: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
}

export type DeliveryRequestedContract = {
  id: string
  status: string
  listingId: string
  listingTitle: string
  listingPhotoUrl: string | null
  pickupAddressLabel?: string | null
  dropoffAddressLabel?: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupInstructions: string | null
  itemTraits: string[]
  bidAmountCents: number | null
  bidPerKmFeeCents?: number | null
  acceptedAt?: string | null
  estimatedDeliveryAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  deliveryPhotoUrl?: string | null
  groupThreadId: string | null
  requesterRole: 'buyer' | 'seller'
  buyer: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  seller: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  driver: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  } | null
}

export function formatMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((Number(cents) || 0) / 100)
}

export function formatDistance(distanceKm: number | null | undefined) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return 'Distance unavailable'
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km away`
  return `${Math.round(distanceKm)} km away`
}

export function formatParticipantName(participant: { name: string | null; handle: string | null }) {
  return participant.name?.trim() || participant.handle?.trim() || 'Civil citizen'
}

export function formatContractStatus(status: string) {
  const normalized = (status || '').trim().toLowerCase()
  switch (normalized) {
    case 'open':
      return 'Open for bids'
    case 'bid_pending':
      return 'Waiting for buyer'
    case 'assigned':
      return 'Assigned'
    case 'picked_up':
      return 'Picked up'
    case 'delivered':
      return 'Delivered'
    case 'rejected':
      return 'Declined'
    default:
      return normalized ? normalized.replace(/_/g, ' ') : 'Unknown'
  }
}

export function getDeliveryRequirementItems(requirements: Partial<DeliveryRequirementMap> | null | undefined) {
  return [
    { key: 'walletReady', label: 'Civil Wallet with Stripe payouts enabled', met: requirements?.walletReady === true },
    { key: 'isCanadianCitizen', label: 'Canadian citizenship confirmed', met: requirements?.isCanadianCitizen === true },
    { key: 'hasProfilePhoto', label: 'Profile photo added', met: requirements?.hasProfilePhoto === true },
    { key: 'hasHomeAddress', label: 'Home address saved', met: requirements?.hasHomeAddress === true },
  ]
}

export function pickMediaVariantUrl(variants: unknown) {
  if (!variants || typeof variants !== 'object') return null
  const items = Object.values(variants as Record<string, unknown>).filter((entry): entry is { url?: string; variant?: string } => Boolean(entry && typeof entry === 'object'))
  const preferred = items.find((entry) => entry.variant === 'public') ?? items.find((entry) => entry.variant === 'large') ?? items[0]
  return typeof preferred?.url === 'string' && preferred.url.trim() ? preferred.url : null
}