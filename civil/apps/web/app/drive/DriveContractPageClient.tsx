'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  HiOutlineArrowUturnLeft,
  HiOutlineCalendarDays,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineCheckCircle,
  HiOutlineClock,
  HiOutlineFlag,
  HiOutlineMap,
  HiOutlineMapPin,
  HiOutlinePhone,
  HiOutlineVideoCamera,
} from 'react-icons/hi2'
import CivilCard from '../_components/CivilCard'
import DashboardShell from '../_components/DashboardShell'
import Modal from '../_components/Modal'
import { RightRail } from '../_components/RightRail'
import { AddressDirectionsMap, type AddressDirectionsMapHandle } from '../_components/map/AddressDirectionsMap'
import { pushToast } from '../_components/useToasts'
import { calculateDistanceKm, fetchDrivingRoute } from '../_lib/addressSearch'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { formatCanadianPhysicalAddressInline } from '../_lib/canadianAddresses'
import { getStoredToken } from '../_lib/tokenStorage'
import MessageCallClient from '../messages/_components/MessageCallClient'
import DriveDriverEarningsRail from './DriveDriverEarningsRail'
import DriveModeRail from './DriveModeRail'
import DriveNextContractsRail from './DriveNextContractsRail'
import {
  formatDriveDurationMinutes,
  formatDriveDateTime,
  formatDriveMoney,
  formatDrivePersonName,
  formatDriveRelativePickupTime,
  getDrivePickupTimingStatus,
  formatDriveStatus,
  getAvatarInitials,
  getDriveStatusTone,
  type DriveRideRequestItem,
} from './driveShared'
import { useDriveViewerState } from './useDriveViewerState'

type RideMutationResponse = {
  item?: DriveRideRequestItem | null
  status?: string
  contractStartedAt?: string | null
  completedAt?: string | null
  earningsCreditedCents?: number | null
  error?: string
}

type DirectThreadResponse = {
  thread?: { id?: string | null } | null
  error?: string
}

type StartCallResponse = {
  call?: { id?: string | null } | null
  error?: string
}

type ActiveDriveCallOverlay = {
  threadId: string
  mode: 'audio' | 'video'
}

type MapPoint = {
  latitude: number
  longitude: number
  label: string
}

function buildMapPoint(
  address:
    | DriveRideRequestItem['pickupAddress']
    | DriveRideRequestItem['dropoffAddress']
    | DriveRideRequestItem['driverLocation']
    | DriveRideRequestItem['requesterLocation']
    | null
    | undefined,
  fallbackLabel: string,
): MapPoint | null {
  if (
    !address ||
    typeof address.latitude !== 'number' ||
    !Number.isFinite(address.latitude) ||
    typeof address.longitude !== 'number' ||
    !Number.isFinite(address.longitude)
  ) {
    return null
  }

  return {
    latitude: address.latitude,
    longitude: address.longitude,
    label: 'line1' in address ? formatCanadianPhysicalAddressInline(address) || fallbackLabel : fallbackLabel,
  }
}

function formatTripTimeLabel(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return 'Unavailable'
  const roundedMinutes = Math.max(1, Math.round(minutes))
  if (roundedMinutes < 60) return `${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'}`

  const hours = Math.floor(roundedMinutes / 60)
  const remainingMinutes = roundedMinutes % 60
  if (remainingMinutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`
}

function formatDistanceLabel(km: number | null) {
  if (km === null || !Number.isFinite(km)) return 'Unavailable'
  return `${km.toFixed(1)} km`
}

function isTerminalRideStatus(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  return ['completed', 'cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(normalized)
}

type ContractActionKey = 'arrived_pickup' | 'cancel_arrival' | 'picked_up' | 'cancel_pickup' | 'dropped_off' | 'cancel_dropoff' | 'complete'

function getContractActionFallbackStatus(action: ContractActionKey, currentStatus: string | null | undefined) {
  const normalized = (currentStatus || '').trim().toLowerCase()
  switch (action) {
    case 'arrived_pickup':
      return ['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route'].includes(normalized)
        ? 'driver_arrived'
        : normalized
    case 'cancel_arrival':
      return normalized === 'driver_arrived' ? 'driver_en_route' : normalized
    case 'picked_up':
      return normalized === 'driver_arrived' ? 'picked_up' : normalized
    case 'cancel_pickup':
      return normalized === 'picked_up' || normalized === 'in_progress' ? 'driver_arrived' : normalized
    case 'dropped_off':
      return normalized === 'picked_up' || normalized === 'in_progress' ? 'arrived' : normalized
    case 'cancel_dropoff':
      return normalized === 'arrived' ? 'picked_up' : normalized
    case 'complete':
      return 'completed'
    default:
      return normalized
  }
}

function getContractActions(status: string | null | undefined) {
  const normalized = (status || '').trim().toLowerCase()

  if (['accepted', 'assigned', 'matched', 'driver_selected', 'driver_en_route', 'en_route'].includes(normalized)) {
    return {
      primary: { key: 'arrived_pickup' as const, label: 'Arrived for pickup' },
      secondary: null,
      helperText: 'Mark the moment you reach the pickup point.',
    }
  }

  if (normalized === 'driver_arrived') {
    return {
      primary: { key: 'picked_up' as const, label: 'Passengers picked up' },
      secondary: { key: 'cancel_arrival' as const, label: 'Undo Arrival' },
      helperText: 'Use Undo if you need to return this contract to en route status.',
    }
  }

  if (normalized === 'picked_up' || normalized === 'in_progress') {
    return {
      primary: { key: 'dropped_off' as const, label: 'Passengers Dropped off' },
      secondary: { key: 'cancel_pickup' as const, label: 'Undo Passenger Pickup' },
      helperText: 'Mark dropoff once the ride reaches its destination.',
    }
  }

  if (normalized === 'arrived') {
    return {
      primary: { key: 'complete' as const, label: 'Complete Contract' },
      secondary: { key: 'cancel_dropoff' as const, label: 'Undo Dropoff Arrival' },
      helperText: 'Completing the contract pays out the driver wallet immediately.',
    }
  }

  return {
    primary: null,
    secondary: null,
    helperText: normalized === 'completed' ? 'This contract has been completed and settled.' : 'The next contract action will appear here when it is available.',
  }
}

function renderContractActionIcon(action: ContractActionKey) {
  switch (action) {
    case 'arrived_pickup':
      return <HiOutlineMapPin className="h-5 w-5" />
    case 'picked_up':
      return <HiOutlineCheckCircle className="h-5 w-5" />
    case 'dropped_off':
      return <HiOutlineFlag className="h-5 w-5" />
    case 'complete':
      return <HiOutlineCheckCircle className="h-5 w-5" />
    case 'cancel_arrival':
    case 'cancel_pickup':
    case 'cancel_dropoff':
      return <HiOutlineArrowUturnLeft className="h-5 w-5" />
    default:
      return null
  }
}

function getContractActionButtonClass(action: ContractActionKey) {
  if (action === 'cancel_arrival' || action === 'cancel_pickup' || action === 'cancel_dropoff') {
    return 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
  }

  return 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500'
}

function getContractActionConfirmationLabel(action: ContractActionKey) {
  switch (action) {
    case 'arrived_pickup':
      return 'Arrived for Pickup'
    case 'picked_up':
      return 'Passengers Picked Up'
    case 'dropped_off':
      return 'Passengers Dropped Off'
    case 'complete':
      return 'Complete Contract'
    case 'cancel_arrival':
      return 'Undo Arrival'
    case 'cancel_pickup':
      return 'Undo Passenger Pickup'
    case 'cancel_dropoff':
      return 'Undo Dropoff Arrival'
    default:
      return 'Continue'
  }
}

export default function DriveContractPageClient({ rideId }: { rideId: string }) {
  const router = useRouter()
  const directionsMapRef = useRef<AddressDirectionsMapHandle | null>(null)
  const {
    isDriverActive,
    loading: viewerLoading,
    rideRequestCount,
    deliveryRequestCount,
    exitDriverMode,
  } = useDriveViewerState()
  const [loading, setLoading] = useState(true)
  const [ride, setRide] = useState<DriveRideRequestItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [contractActionLoading, setContractActionLoading] = useState<ContractActionKey | null>(null)
  const [localDriverPoint, setLocalDriverPoint] = useState<MapPoint | null>(null)
  const [navigationOrigin, setNavigationOrigin] = useState<MapPoint | null>(null)
  const [approachRouteCoordinates, setApproachRouteCoordinates] = useState<Array<[number, number]> | null>(null)
  const [travelMinutesToPickup, setTravelMinutesToPickup] = useState<number | null>(null)
  const [travelMinutesTrip, setTravelMinutesTrip] = useState<number | null>(null)
  const [distanceKmToPickup, setDistanceKmToPickup] = useState<number | null>(null)
  const [distanceKmTrip, setDistanceKmTrip] = useState<number | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)
  const [callMode, setCallMode] = useState<'audio' | 'video' | null>(null)
  const [activeCallOverlay, setActiveCallOverlay] = useState<ActiveDriveCallOverlay | null>(null)
  const [confirmContractAction, setConfirmContractAction] = useState<ContractActionKey | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadRide() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(rideId)}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as RideMutationResponse | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (cancelled) return

        if (!response.ok || !payload?.item) {
          setRide(null)
          setError(payload?.error === 'ride_not_found' ? 'That contract could not be found.' : 'Unable to load this contract right now.')
          return
        }

        const nextRide = payload.item
        if (nextRide.viewerRole !== 'driver') {
          setRide(null)
          setError('This contract is only available to the assigned driver.')
          return
        }

        if (!nextRide.acceptedOfferId) {
          setRide(nextRide)
          setError('This contract is no longer available.')
          return
        }

        setRide(nextRide)
      } catch (loadError) {
        console.error('Failed to load drive contract', loadError)
        if (cancelled) return
        setRide(null)
        setError('Unable to load this contract right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadRide()
    return () => {
      cancelled = true
    }
  }, [rideId])

  useEffect(() => {
    if (!ride || ride.driverLocation || typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocalDriverPoint(null)
      return
    }

    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setLocalDriverPoint({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: 'Your current location',
        })
      },
      () => {
        if (cancelled) return
        setLocalDriverPoint(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    )

    return () => {
      cancelled = true
    }
  }, [ride])

  useEffect(() => {
    if (!ride || ride.viewerRole !== 'driver' || !ride.acceptedOfferId || ride.contractStartedAt || isTerminalRideStatus(ride.status)) {
      return
    }

    const currentRideId = ride.id
    let cancelled = false

    async function startContract() {
      const token = getStoredToken()
      if (!token) return

      try {
        const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(currentRideId)}/start`), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
        const payload = (await response.json().catch(() => null)) as RideMutationResponse | null

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        if (!response.ok || cancelled) return

        setRide((current) =>
          current && current.id === currentRideId
            ? {
                ...current,
                status: payload?.status ?? current.status,
                contractStartedAt: payload?.contractStartedAt ?? current.contractStartedAt ?? new Date().toISOString(),
              }
            : current,
        )
      } catch (error) {
        if (cancelled) return
        console.error('Failed to start drive contract', error)
      }
    }

    void startContract()

    return () => {
      cancelled = true
    }
  }, [ride])

  const pickupPoint = useMemo(() => buildMapPoint(ride?.pickupAddress, 'Pickup'), [ride?.pickupAddress])
  const destinationPoint = useMemo(() => buildMapPoint(ride?.dropoffAddress, 'Destination'), [ride?.dropoffAddress])
  const driverPoint = useMemo(() => {
    if (navigationOrigin) return navigationOrigin
    if (ride?.driverLocation) return buildMapPoint(ride.driverLocation, 'Your current location')
    return localDriverPoint
  }, [localDriverPoint, navigationOrigin, ride?.driverLocation])

  useEffect(() => {
    if (!pickupPoint || !destinationPoint) {
      setApproachRouteCoordinates(null)
      setTravelMinutesToPickup(null)
      setTravelMinutesTrip(null)
      setDistanceKmToPickup(null)
      setDistanceKmTrip(null)
      return
    }

    const controller = new AbortController()
    const pickup = pickupPoint
    const destination = destinationPoint
    const driver = driverPoint

    const fallbackTripDistanceKm = calculateDistanceKm(pickup, destination)
    setDistanceKmTrip(fallbackTripDistanceKm)
    setTravelMinutesTrip(null)

    if (driver) {
      setDistanceKmToPickup(calculateDistanceKm(driver, pickup))
    } else {
      setDistanceKmToPickup(null)
      setTravelMinutesToPickup(null)
      setApproachRouteCoordinates(null)
    }

    async function loadRoutes() {
      const [approachRoute, tripRoute] = await Promise.all([
        driver ? fetchDrivingRoute(driver, pickup, controller.signal).catch(() => null) : Promise.resolve(null),
        fetchDrivingRoute(pickup, destination, controller.signal).catch(() => null),
      ])

      if (controller.signal.aborted) return

      if (approachRoute) {
        setApproachRouteCoordinates(approachRoute.geometry)
        setTravelMinutesToPickup(Math.max(1, Math.round(approachRoute.durationSeconds / 60)))
        setDistanceKmToPickup(approachRoute.distanceMeters / 1000)
      } else {
        setApproachRouteCoordinates(null)
        setTravelMinutesToPickup(null)
      }

      if (tripRoute) {
        setTravelMinutesTrip(Math.max(1, Math.round(tripRoute.durationSeconds / 60)))
        setDistanceKmTrip(tripRoute.distanceMeters / 1000)
      }
    }

    void loadRoutes()
      .catch((routeError) => {
        if (controller.signal.aborted) return
        console.error('Failed to load contract route preview', routeError)
      })

    return () => controller.abort()
  }, [destinationPoint, driverPoint, pickupPoint])

  const riderLabel = ride ? formatDrivePersonName(ride.requester) : 'Rider'
  const riderHandle = ride?.requester.handle?.trim() ?? ''
  const riderUserId = ride?.requester.id ?? null
  const pickupLabel = ride ? formatCanadianPhysicalAddressInline(ride.pickupAddress) || 'Pickup pending' : 'Pickup pending'
  const destinationLabel = ride ? formatCanadianPhysicalAddressInline(ride.dropoffAddress) || 'Destination pending' : 'Destination pending'
  const pickupTimingLabel = ride ? formatDriveRelativePickupTime(ride.pickupAt) : 'Not scheduled'
  const pickupTimingStatus = ride ? getDrivePickupTimingStatus(ride.pickupAt, travelMinutesToPickup) : null
  const totalTripMinutes = travelMinutesToPickup !== null && travelMinutesTrip !== null ? travelMinutesToPickup + travelMinutesTrip : travelMinutesTrip
  const totalTripDistanceKm = distanceKmToPickup !== null && distanceKmTrip !== null ? distanceKmToPickup + distanceKmTrip : distanceKmTrip
  const canStartGps = Boolean(pickupPoint && ride && !isTerminalRideStatus(ride.status))
  const pickupTimingSummary =
    !pickupTimingStatus
      ? null
      : pickupTimingStatus.state === 'late'
        ? `You are running ${formatDriveDurationMinutes(pickupTimingStatus.deltaMinutes)} late for pickup.`
        : pickupTimingStatus.state === 'early'
          ? `You are on pace to arrive ${formatDriveDurationMinutes(Math.abs(pickupTimingStatus.deltaMinutes))} early.`
          : 'You are on time for pickup.'
  const pickupTimingValueTone =
    pickupTimingStatus?.state === 'late'
      ? 'text-rose-700'
      : pickupTimingStatus?.state === 'early'
        ? 'text-emerald-700'
        : 'text-sky-700'

  const handleExitDriverMode = () => {
    exitDriverMode()
    router.push('/drive')
  }

  const handleStartGps = () => {
    if (!pickupPoint) {
      pushToast('Pickup coordinates are not ready yet.', 'error')
      return
    }
    void directionsMapRef.current?.startNavigation()
  }

  async function ensureDirectThread() {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return null
    }
    if (!riderUserId) return null

    const response = await fetch(buildApiUrl('/messages/threads/direct'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: riderUserId }),
    })

    const payload = (await response.json().catch(() => null)) as DirectThreadResponse | null
    if (response.status === 401) {
      redirectToAuthModal('login')
      return null
    }
    if (!response.ok || !payload?.thread?.id) {
      pushToast(
        payload?.error === 'not_friends'
          ? 'Messaging opens once this Drive relationship is connected.'
          : payload?.error ?? 'Unable to open that conversation right now.',
        'error',
      )
      return null
    }

    return payload.thread.id
  }

  async function handleStartMessage() {
    if (!riderUserId || messageLoading || callMode) return
    setMessageLoading(true)
    try {
      const threadId = await ensureDirectThread()
      if (!threadId) return
      router.push(`/messages?inbox=drivers&thread=${encodeURIComponent(threadId)}`)
    } finally {
      setMessageLoading(false)
    }
  }

  async function handleStartCall(mode: 'audio' | 'video') {
    if (!riderUserId || messageLoading || callMode) return
    setCallMode(mode)
    try {
      const threadId = await ensureDirectThread()
      if (!threadId) return

      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      const response = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}/call/start`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mode,
          inviteMeta: {
            contextLabel: 'Your Driver',
            imageUrl: ride?.driverVehicle?.photoUrl ?? null,
            imageAlt: ride?.driverVehicle?.name ? `${ride.driverVehicle.name} vehicle` : `${riderLabel} contract`,
            imageLabel: ride?.driverVehicle?.name ?? null,
          },
        }),
      })

      const payload = (await response.json().catch(() => null)) as StartCallResponse | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok || !payload?.call?.id) {
        pushToast(payload?.error ?? 'Unable to start this call right now.', 'error')
        return
      }

      setActiveCallOverlay({ threadId, mode })
    } finally {
      setCallMode(null)
    }
  }

  async function handleContractAction(action: ContractActionKey) {
    if (!ride || contractActionLoading) return

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setContractActionLoading(action)
    try {
      const isComplete = action === 'complete'
      const response = await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(ride.id)}${isComplete ? '/complete' : '/contract-action'}`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(isComplete ? {} : { 'content-type': 'application/json' }),
        },
        ...(isComplete ? {} : { body: JSON.stringify({ action }) }),
      })

      const payload = (await response.json().catch(() => null)) as RideMutationResponse | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        const message =
          payload?.error === 'invalid_contract_action'
            ? 'That contract action is not available right now.'
            : payload?.error === 'ride_not_completable'
              ? 'This contract is not ready to complete yet.'
              : payload?.error === 'ride_not_in_escrow'
                ? 'This contract payout has already been settled.'
                : payload?.error === 'ride_completion_already_requested'
                  ? 'This contract has already been completed.'
                  : payload?.error ?? 'Unable to update the contract right now.'
        pushToast(message, 'error')
        return
      }

      const completedAt = payload?.completedAt ?? new Date().toISOString()
      const nextStatus = payload?.status ?? getContractActionFallbackStatus(action, ride.status)
      setRide((current) =>
        current && current.id === ride.id
          ? {
              ...current,
              status: nextStatus,
              contractStartedAt: payload?.contractStartedAt ?? current.contractStartedAt ?? new Date().toISOString(),
              completionRequestedAt: action === 'complete' ? completedAt : current.completionRequestedAt,
              completionConfirmationDueAt: action === 'complete' ? null : current.completionConfirmationDueAt,
              riderConfirmedCompleteAt: action === 'complete' ? completedAt : current.riderConfirmedCompleteAt,
              escrowStatus: action === 'complete' ? 'released' : current.escrowStatus,
            }
          : current,
      )

      if (action === 'complete') {
        const payoutLabel = formatDriveMoney(payload?.earningsCreditedCents ?? ride.acceptedOfferAmountCents ?? ride.driverFeeCents)
        pushToast(`Contract completed. ${payoutLabel} moved to your wallet.`, 'success')
        if (typeof window !== 'undefined') {
          const audio = new Audio('/money.caf')
          void audio.play().catch((soundError) => {
            console.warn('drive_contract_money_sound_failed', soundError)
          })
        }
        return
      }

      const successMessage =
        action === 'arrived_pickup'
          ? 'Marked as arrived for pickup.'
          : action === 'cancel_arrival'
            ? 'Arrival cancelled.'
            : action === 'picked_up'
              ? 'Passengers marked as picked up.'
              : action === 'cancel_pickup'
                ? 'Passenger pickup cancelled.'
                : action === 'dropped_off'
                  ? 'Passengers marked as dropped off.'
                  : 'Passenger drop off cancelled.'
      pushToast(successMessage, 'success')
    } catch (contractError) {
      console.error('Failed to update drive contract action', contractError)
      pushToast('Unable to update the contract right now.', 'error')
    } finally {
      setContractActionLoading(null)
    }
  }

  const contactButtonsDisabled = !riderUserId || messageLoading || Boolean(callMode)
  const riderProfileHref = riderHandle ? `/u/${encodeURIComponent(riderHandle)}` : undefined
  const contractActions = getContractActions(ride?.status)
  const payoutSettled = ride?.status === 'completed' && ride.escrowStatus === 'released'
  const confirmContractActionLabel = confirmContractAction ? getContractActionConfirmationLabel(confirmContractAction) : ''
  const fullscreenRiderOverlay = ride ? (
    <div className="w-full rounded-[1.6rem] border border-white/60 bg-white/94 p-4 text-slate-950 shadow-[0_22px_60px_rgba(15,23,42,0.24)] backdrop-blur md:max-w-sm">
      <div className="hidden items-start justify-between gap-3 md:flex">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Your Rider</p>
        </div>
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getDriveStatusTone(ride.status)}`}>
          {formatDriveStatus(ride.status)}
        </span>
      </div>
      <div className="md:hidden">
        <div className="grid grid-cols-5 gap-2">
          <a
            href={riderProfileHref}
            aria-label={riderLabel}
            className="inline-flex min-h-[3.5rem] items-center justify-center rounded-full bg-transparent shadow-none transition"
          >
            {ride.requester.avatarUrl ? (
              <img src={ride.requester.avatarUrl} alt={riderLabel} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
                {getAvatarInitials(riderLabel)}
              </span>
            )}
          </a>
          <button
            type="button"
            onClick={() => {
              void handleStartMessage()
            }}
            disabled={contactButtonsDisabled}
            aria-label={messageLoading ? 'Opening messages' : 'Open messages'}
            className="inline-flex min-h-[3.5rem] items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-3 text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HiOutlineChatBubbleOvalLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              void handleStartCall('audio')
            }}
            disabled={contactButtonsDisabled}
            aria-label={callMode === 'audio' ? 'Starting audio call' : 'Start audio call'}
            className="inline-flex min-h-[3.5rem] items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-3 text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HiOutlinePhone className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              void handleStartCall('video')
            }}
            disabled={contactButtonsDisabled}
            aria-label={callMode === 'video' ? 'Starting video call' : 'Start video call'}
            className="inline-flex min-h-[3.5rem] items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-3 text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HiOutlineVideoCamera className="h-5 w-5" />
          </button>
          {contractActions.primary ? (
            <button
              type="button"
              onClick={() => {
                setConfirmContractAction(contractActions.primary.key)
              }}
              disabled={Boolean(contractActionLoading)}
              aria-label={contractActions.primary.label}
              className={`inline-flex min-h-[3.5rem] items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${getContractActionButtonClass(contractActions.primary.key)}`}
            >
              {renderContractActionIcon(contractActions.primary.key)}
            </button>
          ) : (
            <div aria-hidden="true" className="min-h-[3.5rem]" />
          )}
        </div>
      </div>
      <div className="hidden md:block [&_.cc-civil-card__title]:!whitespace-normal [&_.cc-civil-card__title]:!line-clamp-none [&_.cc-civil-card__title]:!overflow-visible">
        <CivilCard
          size="md"
          name={riderLabel}
          avatarAlt={riderLabel}
          avatarSrc={ride.requester.avatarUrl}
          avatarInitials={getAvatarInitials(riderLabel)}
          coverUrl={ride.requester.coverUrl}
          href={riderProfileHref}
          titleLines={0}
          subtitleLines={0}
          className="mt-3 border-white/35 shadow-[0_16px_42px_rgba(15,23,42,0.12)]"
        />
      </div>
      {contractActions.primary ? (
        <>
          <button
            type="button"
            onClick={() => {
              void handleContractAction(contractActions.primary.key)
            }}
            disabled={Boolean(contractActionLoading)}
            className={`mt-3 hidden w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 md:inline-flex ${getContractActionButtonClass(contractActions.primary.key)}`}
          >
            {renderContractActionIcon(contractActions.primary.key)}
            {contractActionLoading === contractActions.primary.key ? 'Working…' : contractActions.primary.label}
          </button>
        </>
      ) : null}
      <div className="mt-3 hidden gap-2 sm:grid-cols-2 md:grid">
        <button
          type="button"
          onClick={() => {
            void handleStartCall('audio')
          }}
          disabled={contactButtonsDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <HiOutlinePhone className="h-4 w-4" />
          {callMode === 'audio' ? 'Calling…' : 'Audio Call'}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleStartCall('video')
          }}
          disabled={contactButtonsDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <HiOutlineVideoCamera className="h-4 w-4" />
          {callMode === 'video' ? 'Calling…' : 'Video Call'}
        </button>
      </div>
    </div>
  ) : null

  const embeddedCallOverlay =
    activeCallOverlay && typeof document !== 'undefined'
      ? createPortal(
          <div className="pointer-events-none fixed inset-0 z-[120]">
            <div
              className="pointer-events-auto absolute inset-x-3 bottom-3 overflow-hidden rounded-[1.75rem] border border-white/15 shadow-[0_30px_80px_rgba(15,23,42,0.38)] backdrop-blur sm:inset-x-auto sm:right-4 sm:top-4"
              style={{
                width: activeCallOverlay.mode === 'video' ? 'min(34rem, calc(100vw - 2rem))' : 'min(27rem, calc(100vw - 2rem))',
                height: activeCallOverlay.mode === 'video' ? 'min(42rem, calc(100dvh - 2rem))' : 'min(34rem, calc(100dvh - 2rem))',
              }}
            >
              <MessageCallClient threadId={activeCallOverlay.threadId} embedded onClose={() => setActiveCallOverlay(null)} />
            </div>
          </div>,
          document.body,
        )
      : null

  const fullscreenActionConfirmationModal = confirmContractAction ? (
    <Modal
      open
      onClose={() => {
        if (contractActionLoading) return
        setConfirmContractAction(null)
      }}
      title="Confirm Contract Action"
      maxWidthClassName="max-w-sm"
      closeOnBackdrop={!contractActionLoading}
      closeOnEscape={!contractActionLoading}
    >
      <div className="space-y-4">
        <p className="text-base font-semibold text-slate-950">{`Confirm ${confirmContractActionLabel}?`}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirmContractAction(null)}
            disabled={Boolean(contractActionLoading)}
            className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const action = confirmContractAction
              if (!action) return
              void handleContractAction(action).finally(() => {
                setConfirmContractAction(null)
              })
            }}
            disabled={Boolean(contractActionLoading)}
            className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {contractActionLoading === confirmContractAction ? 'Working…' : 'Yes'}
          </button>
        </div>
      </div>
    </Modal>
  ) : null

  return (
    <>
      {fullscreenActionConfirmationModal}
      <DashboardShell
        rightRail={
          <div className="space-y-5">
            <DriveModeRail
              isDriverActive={isDriverActive}
              isDriverMode
              loading={viewerLoading}
              rideRequestCount={rideRequestCount}
              deliveryRequestCount={deliveryRequestCount}
              onExitDriverMode={handleExitDriverMode}
            />
            <DriveDriverEarningsRail enabled={isDriverActive} />
            <DriveNextContractsRail currentRideId={rideId} />
            <RightRail mode="drive" organizationLinkTarget="chat" showDriveCallout={false} />
          </div>
        }
        showMobileRightRail
        mainClassName="space-y-6 pb-12"
        rightRailClassName="pb-12"
      >
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Driver</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">Contract</h1>
          </div>
          <button
            type="button"
            onClick={handleStartGps}
            disabled={!canStartGps || loading || Boolean(error)}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--cc-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HiOutlineMap className="h-4 w-4 shrink-0" />
            {ride && isTerminalRideStatus(ride.status) ? 'Review Contract' : 'Start GPS'}
          </button>
        </section>

        {loading ? (
          <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">
            Loading contract…
          </section>
        ) : null}

        {!loading && error ? (
          <section className="rounded-[1.8rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        {!loading && ride && !error ? (
          <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(20rem,0.84fr)]">
              <div className="space-y-4">
                <div className="rounded-[1.6rem] border border-slate-200">
                  <AddressDirectionsMap
                    ref={directionsMapRef}
                    origin={driverPoint}
                    destination={pickupPoint}
                    routeCoordinates={approachRouteCoordinates}
                    showOriginAvatar={Boolean(driverPoint)}
                    originAvatarUrl={ride.driverVehicle?.photoUrl ?? null}
                    originAvatarLabel={ride.driverVehicle?.name ?? 'Driver vehicle'}
                    originAvatarFallbackLabel={getAvatarInitials(ride.driverVehicle?.name || 'Vehicle')}
                    onNavigationOriginChange={setNavigationOrigin}
                    fullscreenOverlay={fullscreenRiderOverlay}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Pickup</p>
                    <div className="mt-2 flex items-start gap-2">
                      <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500" />
                      <p className="text-sm font-medium leading-6 text-slate-900">{pickupLabel}</p>
                    </div>
                  </div>
                  <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Dropoff</p>
                    <div className="mt-2 flex items-start gap-2">
                      <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-rose-500" />
                      <p className="text-sm font-medium leading-6 text-slate-900">{destinationLabel}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4 shadow-[0_18px_54px_rgba(14,165,233,0.10)]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Rider</p>
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getDriveStatusTone(ride.status)}`}>
                      {formatDriveStatus(ride.status)}
                    </span>
                  </div>
                  <div className="[&_.cc-civil-card__title]:!whitespace-normal [&_.cc-civil-card__title]:!line-clamp-none [&_.cc-civil-card__title]:!overflow-visible">
                    <CivilCard
                      size="md"
                      name={riderLabel}
                      avatarAlt={riderLabel}
                      avatarSrc={ride.requester.avatarUrl}
                      avatarInitials={getAvatarInitials(riderLabel)}
                      coverUrl={ride.requester.coverUrl}
                      href={riderProfileHref}
                      titleLines={0}
                      subtitleLines={0}
                      className="mt-3 border-white/35 shadow-[0_16px_42px_rgba(15,23,42,0.12)]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartMessage()
                    }}
                    disabled={!riderUserId || messageLoading || Boolean(callMode)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <HiOutlineChatBubbleOvalLeft className="h-4 w-4" />
                    {messageLoading ? 'Opening…' : 'Message'}
                  </button>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleStartCall('audio')
                      }}
                      disabled={contactButtonsDisabled}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <HiOutlinePhone className="h-4 w-4" />
                      {callMode === 'audio' ? 'Calling…' : 'Audio Call'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleStartCall('video')
                      }}
                      disabled={contactButtonsDisabled}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <HiOutlineVideoCamera className="h-4 w-4" />
                      {callMode === 'video' ? 'Calling…' : 'Video Call'}
                    </button>
                  </div>
                  {pickupTimingSummary ? <p className={`mt-3 text-sm font-semibold leading-6 ${pickupTimingValueTone}`}>{pickupTimingSummary}</p> : null}
                </div>

                <div className="grid gap-3">
                  <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Contract actions</p>
                    <div className="mt-3 space-y-2">
                      {contractActions.primary ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleContractAction(contractActions.primary.key)
                          }}
                          disabled={Boolean(contractActionLoading)}
                          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${getContractActionButtonClass(contractActions.primary.key)}`}
                        >
                          {renderContractActionIcon(contractActions.primary.key)}
                          {contractActionLoading === contractActions.primary.key ? 'Working…' : contractActions.primary.label}
                        </button>
                      ) : null}
                      {contractActions.secondary ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleContractAction(contractActions.secondary.key)
                          }}
                          disabled={Boolean(contractActionLoading)}
                          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${getContractActionButtonClass(contractActions.secondary.key)}`}
                        >
                          {renderContractActionIcon(contractActions.secondary.key)}
                          {contractActionLoading === contractActions.secondary.key ? 'Working…' : contractActions.secondary.label}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm text-slate-500">{contractActions.helperText}</p>
                    {payoutSettled ? (
                      <p className="mt-3 text-sm font-semibold text-emerald-700">
                        Wallet payout settled: {formatDriveMoney(ride.acceptedOfferAmountCents ?? ride.driverFeeCents)}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pickup time</p>
                    <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <HiOutlineClock className="h-4 w-4 text-slate-400" />
                      {pickupTimingLabel}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <HiOutlineCalendarDays className="h-4 w-4 text-slate-400" />
                      {formatDriveDateTime(ride.pickupAt)}
                    </p>
                  </div>

                  <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Route overview</p>
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 text-slate-600">
                          <HiOutlineMapPin className="h-4 w-4 text-slate-400" />
                          To pickup
                        </span>
                        <span className="font-semibold text-slate-950">
                          {driverPoint ? formatTripTimeLabel(travelMinutesToPickup) : 'Start GPS for live route'}
                        </span>
                      </div>
                      {pickupTimingStatus ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-600">Pickup timing</span>
                          <span className={`font-semibold ${pickupTimingValueTone}`}>{pickupTimingStatus.label}</span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Pickup to dropoff</span>
                        <span className="font-semibold text-slate-950">{formatTripTimeLabel(travelMinutesTrip)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-amber-200 pt-3">
                        <span className="text-slate-600">Total trip time</span>
                        <span className="font-semibold text-slate-950">{formatTripTimeLabel(totalTripMinutes)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Total distance</span>
                        <span className="font-semibold text-slate-950">{formatDistanceLabel(totalTripDistanceKm)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Distance to pickup</span>
                        <span className="font-semibold text-slate-950">{formatDistanceLabel(distanceKmToPickup)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </DashboardShell>
      {embeddedCallOverlay}
    </>
  )
}
