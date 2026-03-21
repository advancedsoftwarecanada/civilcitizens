import type { CanadianAddress } from '../_lib/canadianAddresses'

export type DriveRideRequestItem = {
  id: string
  status: string
  recurrence: 'once' | 'recurring'
  pickupAddress: CanadianAddress | null
  dropoffAddress: CanadianAddress | null
  pickupAt: string
  dropoffAt: string
  routeDistanceKm: number
  fuelChargeCents: number
  driverFeeCents: number
  totalCostCents: number
  createdAt: string
  requester: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  isOwner: boolean
}

export type DriveDeliveryItem = {
  id: string
  status: string
  listingId: string
  listingTitle: string
  listingPhotoUrl: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupInstructions: string | null
  itemTraits: string[]
  bidPending: boolean
  bidAmountCents: number | null
  createdAt: string
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

export type DriveDriverItem = {
  id: string
  handle: string | null
  name: string | null
  bio: string | null
  avatarUrl: string | null
  coverUrl: string | null
  activeAt: string | null
  city: string | null
  province: string | null
  featuredVehicle: {
    id: string
    name: string
    photoUrl: string | null
    minimumRideAmountCents: number
    perKmFeeCents: number
  } | null
}

export type DriveDriverVehicle = {
  id: string
  name: string
  photoUrls: string[]
  minimumRideAmountCents: number
  perKmFeeCents: number
  featured: boolean
  createdAt: string
  updatedAt: string
}

export type DriveDriverManageResponse = {
  active?: boolean
  activeAt?: string | null
  vehicles?: DriveDriverVehicle[]
  error?: string
}

export type DriveFeedResponse<T> = {
  items?: T[]
  error?: string
}

export function formatDriveMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((Number(cents) || 0) / 100)
}

export function formatDriveDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Not scheduled'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDriveDate(value: string | null | undefined) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Recently'
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

export function formatDriveRecurrence(value: 'once' | 'recurring') {
  return value === 'recurring' ? 'Scheduled' : 'One time'
}

export function formatDrivePersonName(person: { name: string | null; handle: string | null }) {
  const trimmedName = person.name?.trim()
  if (trimmedName) return trimmedName
  const trimmedHandle = person.handle?.trim()
  if (trimmedHandle) return `@${trimmedHandle}`
  return 'Civil citizen'
}

export function formatDriveLocation(city: string | null | undefined, province: string | null | undefined) {
  const label = [city?.trim(), province?.trim()].filter((entry): entry is string => Boolean(entry))
  return label.length ? label.join(', ') : 'Location pending'
}

export function getAvatarInitials(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized) return 'CC'
  const parts = normalized.split(/\s+/).filter(Boolean)
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
  return initials || normalized.slice(0, 2).toUpperCase()
}
