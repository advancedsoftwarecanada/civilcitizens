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
  bidPending: boolean
  bidAmountCents: number | null
  bidPerKmFeeCents: number | null
  bidRequestedAt: string | null
  isBidByViewer: boolean
  offerCount: number
  createdAt: string
  viewerRole: 'requester' | 'driver' | null
  driverUserId: string | null
  acceptedOfferId: string | null
  acceptedOfferAmountCents: number | null
  acceptedOfferPerKmFeeCents: number | null
  acceptedOfferAt: string | null
  tippedAmountCents: number | null
  contractStartedAt: string | null
  escrowStatus: string
  walletTransactionId: string | null
  completionRequestedAt: string | null
  completionConfirmationDueAt: string | null
  riderConfirmedCompleteAt: string | null
  riderReportedIssueAt: string | null
  autoCompletedAt: string | null
  supportRequestId: string | null
  driverLocation: {
    latitude: number
    longitude: number
    recordedAt: string | null
  } | null
  requesterLocation: {
    latitude: number
    longitude: number
    recordedAt: string | null
  } | null
  requester: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
  }
  driverVehicle: {
    id: string
    name: string
    photoUrl: string | null
    minimumRideAmountCents: number
    perKmFeeCents: number
  } | null
  isOwner: boolean
}

export type DriveRideOfferItem = {
  id: string
  rideId: string
  status: string
  amountCents: number
  perKmFeeCents: number
  createdAt: string
  updatedAt: string
  driver: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
  }
  featuredVehicle: {
    id: string
    name: string
    photoUrl: string | null
    minimumRideAmountCents: number
    perKmFeeCents: number
  } | null
}

export type DriveDeliveryItem = {
  id: string
  status: string
  listingId: string
  listingTitle: string
  listingPhotoUrl: string | null
  pickupAddressLabel: string | null
  dropoffAddressLabel: string | null
  pickupCity: string | null
  pickupProvince: string | null
  pickupInstructions: string | null
  itemTraits: string[]
  bidPending: boolean
  bidDriverUserId?: string | null
  bidAmountCents: number | null
  bidPerKmFeeCents?: number | null
  routeDistanceKm?: number | null
  distanceKm?: number | null
  isBidByViewer?: boolean
  acceptedAt?: string | null
  estimatedDeliveryAt?: string | null
  pickedUpAt?: string | null
  deliveredAt?: string | null
  deliveryPhotoUrl?: string | null
  groupThreadId?: string | null
  createdAt: string
  viewerRole: 'buyer' | 'seller' | 'driver' | null
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
  vehicles: Array<{
    id: string
    name: string
    photoUrl: string | null
    featured: boolean
  }>
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
  total?: number
  error?: string
}

export type DriveDriverEarningsSummary = {
  todayEarningsCents: number
  todayTipsCents: number
  todayHourlyEarningsCents: number
  thisWeekEarningsCents: number
  thisWeekTipsCents: number
  thisWeekHourlyEarningsCents: number
  todayKm: number
  thisWeekKm: number
  error?: string
}

export type DriveRideOffersResponse = {
  item?: DriveRideRequestItem
  offers?: DriveRideOfferItem[]
  availableCreditsCents?: number
  requiredAmountCents?: number
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

export function formatDriveRelativePickupTime(value: string, options?: { nowThresholdMinutes?: number }) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Not scheduled'

  const nowThresholdMinutes = options?.nowThresholdMinutes ?? 5
  const diffMinutes = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000))
  if (diffMinutes <= nowThresholdMinutes) return 'Now'
  if (diffMinutes < 60) return `In ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`

  const hours = Math.floor(diffMinutes / 60)
  const remainingMinutes = diffMinutes % 60
  if (remainingMinutes === 0) return `In ${hours} hour${hours === 1 ? '' : 's'}`
  return `In ${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`
}

export function formatDriveDurationMinutes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'

  const roundedMinutes = Math.max(0, Math.round(value))
  if (roundedMinutes < 60) return `${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'}`

  const hours = Math.floor(roundedMinutes / 60)
  const remainingMinutes = roundedMinutes % 60
  if (remainingMinutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`
}

export function getDrivePickupTimingStatus(
  pickupAt: string,
  etaMinutes: number | null | undefined,
  options?: { onTimeThresholdMinutes?: number },
) {
  if (etaMinutes === null || etaMinutes === undefined || !Number.isFinite(etaMinutes)) return null

  const pickupDate = new Date(pickupAt)
  if (!Number.isFinite(pickupDate.getTime())) return null

  const onTimeThresholdMinutes = options?.onTimeThresholdMinutes ?? 2
  const scheduledMinutesFromNow = Math.round((pickupDate.getTime() - Date.now()) / 60_000)
  const deltaMinutes = Math.round(etaMinutes) - scheduledMinutesFromNow

  if (deltaMinutes > onTimeThresholdMinutes) {
    return {
      state: 'late' as const,
      deltaMinutes,
      label: `Late by ${formatDriveDurationMinutes(deltaMinutes)}`,
    }
  }

  if (deltaMinutes < -onTimeThresholdMinutes) {
    return {
      state: 'early' as const,
      deltaMinutes,
      label: `${formatDriveDurationMinutes(Math.abs(deltaMinutes))} early`,
    }
  }

  return {
    state: 'on_time' as const,
    deltaMinutes,
    label: 'On time',
  }
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

export function formatDriveStatus(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  switch (normalized) {
    case 'open':
      return 'Awaiting Driver'
    case 'bid_pending':
      return 'Awaiting Driver'
    case 'accepted':
    case 'assigned':
    case 'matched':
    case 'driver_selected':
      return 'Driver Selected'
    case 'driver_en_route':
    case 'en_route':
      return 'Driver en route'
    case 'driver_arrived':
      return 'At Pickup'
    case 'arrived':
      return 'At Dropoff'
    case 'picked_up':
      return 'Passengers Picked Up'
    case 'in_progress':
    case 'inprogress':
      return 'In Transit'
    case 'delivered':
    case 'completed':
      return 'Completed'
    case 'cancelled':
    case 'canceled':
    case 'rejected':
    case 'declined':
    case 'failed':
      return 'Cancelled'
    default:
      return normalized ? normalized.replace(/_/g, ' ') : 'Awaiting Driver'
  }
}

export function getDriveStatusTone(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  switch (normalized) {
    case 'completed':
    case 'delivered':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'cancelled':
    case 'canceled':
    case 'rejected':
    case 'declined':
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    case 'driver_arrived':
    case 'arrived':
    case 'picked_up':
    case 'in_progress':
    case 'inprogress':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'accepted':
    case 'assigned':
    case 'matched':
    case 'driver_selected':
    case 'driver_en_route':
    case 'en_route':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    case 'open':
    case 'bid_pending':
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700'
  }
}

export function canCancelDriveStatus(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return ![
    'accepted',
    'assigned',
    'matched',
    'driver_selected',
    'driver_en_route',
    'en_route',
    'driver_arrived',
    'arrived',
    'picked_up',
    'in_progress',
    'inprogress',
    'delivered',
    'completed',
    'cancelled',
    'canceled',
    'rejected',
    'declined',
    'failed',
  ].includes(normalized)
}

export function canEditDriveRideStatus(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return normalized === 'open' || normalized === 'bid_pending'
}

export function formatDriveDeliveryViewerRole(value: DriveDeliveryItem['viewerRole']) {
  switch (value) {
    case 'buyer':
      return 'Buyer'
    case 'seller':
      return 'Seller'
    case 'driver':
      return 'Driver'
    default:
      return 'Participant'
  }
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
