'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useViewerStore } from '../../_lib/viewerStore'
import { Area } from 'react-easy-crop'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { ensureViewerMe } from '../../_lib/viewerMe'
import type { CommunityOrganization } from '../../_lib/organizations'
import { formatUserDisplayName } from '../../_lib/text'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import Modal from '../../_components/Modal'
import PhotoUpdateModal from '../../_components/PhotoUpdateModal'
import RichTextEditor from '../../_components/RichTextEditor'
import { CanadianAddressEditor } from '../../_components/address/CanadianAddressEditor'
import {
  createEmptyCanadianAddress,
  formatCanadianAddressInline,
  hasCanadianAddressValue,
  normalizeCanadianAddress,
  type CanadianAddress,
} from '../../_lib/canadianAddresses'
import { computeFallbackCropArea, generateCroppedImageBlob, readImageDimensions } from '../../_lib/imageCrop'

type MeResponse = {
  id: string
}

type MediaUploadInitResponse = {
  assetId: string
  upload?: {
    url?: string
    method?: string
    headers?: Record<string, string>
  }
  proxyPath?: string
  maxBytes?: number
}

type MediaAssetStatusResponse = {
  asset?: {
    id: string
    status: 'pending' | 'processing' | 'ready' | 'failed'
    failureReason?: string | null
  }
}

type OrgMemberItem = {
  userId: string
  role: 'OWNER' | 'MANAGER'
  joinedAt: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  }
}

type OrgFollowerItem = {
  userId: string
  role: 'FOLLOWER'
  joinedAt: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  }
}

type OrgMembersResponse = {
  members?: OrgMemberItem[]
  followers?: OrgFollowerItem[]
}

const ORGANIZATION_TYPE_OPTIONS = [
  { value: 'LOCAL_BUSINESS', label: 'Local Business' },
  { value: 'NON_PROFIT', label: 'Non-Profit / Charity' },
  { value: 'COMMUNITY_GROUP', label: 'Community Group' },
  { value: 'EDUCATIONAL', label: 'Educational Organization' },
  { value: 'RELIGIOUS', label: 'Religious / Spiritual Organization' },
  { value: 'GOVERNMENT', label: 'Government / Civic Body' },
  { value: 'ARTS_CULTURE', label: 'Arts & Culture Organization' },
  { value: 'SPORTS_RECREATION', label: 'Sports & Recreation Organization' },
] as const

type OrganizationTypeValue = (typeof ORGANIZATION_TYPE_OPTIONS)[number]['value']

type OrgAuditItem = {
  id: string
  actorUserId: string
  action: string
  createdAt: string
  reason: string | null
  previousValue: unknown
  nextValue: unknown
}

type OrgAuditResponse = {
  items?: OrgAuditItem[]
  nextCursor?: string | null
}

type OrgGovernanceStateResponse = {
  state?: {
    joinMode?: string
    ranks?: unknown[]
    plans?: unknown[]
    sponsors?: unknown[]
    events?: unknown[]
    achievements?: unknown[]
    achievementAwards?: unknown[]
    referrals?: unknown[]
    reputationLedger?: unknown[]
    eventRsvps?: unknown[]
    economics?: unknown[]
  }
}

type OrgGovernanceAnalyticsResponse = {
  summary?: {
    activeMembers?: number
    pendingMembers?: number
    totalMembersTracked?: number
    plans?: number
    referrals?: number
    achievements?: number
    awards?: number
    paidEvents?: number
    events?: number
    totalRsvps?: number
    goingRsvps?: number
    totalRevenueCents?: number
  }
}

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')

const MB = 1024 * 1024
const MEDIA_LIMITS = {
  business_logo: 8 * MB,
  business_cover: 20 * MB,
  post_image: 25 * MB,
} as const

type BusinessMediaCategory = 'business_logo' | 'business_cover'
type UploadStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error'

type PhotoDraftState = {
  file: File | null
  previewUrl: string | null
  crop: { x: number; y: number }
  zoom: number
  croppedAreaPixels: Area | null
  isDirty: boolean
  fullAssetId: string | null
}

const createPhotoDraftState = (): PhotoDraftState => ({
  file: null,
  previewUrl: null,
  crop: { x: 0, y: 0 },
  zoom: 1,
  croppedAreaPixels: null,
  isDirty: false,
  fullAssetId: null,
})

const COVER_EXPORT_WIDTH = 1920
const COVER_EXPORT_HEIGHT = 640
const COVER_ASPECT_RATIO = COVER_EXPORT_WIDTH / COVER_EXPORT_HEIGHT
const LOGO_EXPORT_SIZE = 1024
const MAX_CROP_ZOOM = 3
const HEADLINE_MAX_CHARS = 60

const ORG_JOIN_MODE_OPTIONS = ['PUBLIC', 'INVITE_ONLY', 'APPLICATION_REQUIRED'] as const
const ORG_MEMBERSHIP_STATUS_OPTIONS = ['PENDING', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'BANNED'] as const
const ORG_PERMISSION_OPTIONS = [
  'approve_members',
  'remove_members',
  'promote_members',
  'demote_members',
  'create_ranks',
  'view_audit_logs',
  'manage_membership_plans',
  'view_revenue',
  'issue_refunds',
  'create_paid_events',
  'manage_events',
  'manage_sponsors',
  'manage_referrals',
  'award_achievements',
  'create_announcements',
  'pin_posts',
  'moderate_content',
] as const

const ORG_PERMISSION_HELP: Record<(typeof ORG_PERMISSION_OPTIONS)[number], { label: string; description: string }> = {
  approve_members: { label: 'Approve members', description: 'Approve/activate pending members.' },
  remove_members: { label: 'Remove members', description: 'Kick/ban/suspend members.' },
  promote_members: { label: 'Promote members', description: 'Promote members into elevated roles/ranks (when allowed).' },
  demote_members: { label: 'Demote members', description: 'Remove elevated roles/ranks (when allowed).' },
  create_ranks: { label: 'Create roles', description: 'Create new roles (ranks) and assign permissions.' },
  view_audit_logs: { label: 'View audit log', description: 'View governance actions for transparency.' },
  manage_membership_plans: { label: 'Manage plans', description: 'Create/edit membership plans and join mode.' },
  view_revenue: { label: 'View revenue', description: 'View org revenue summaries and totals.' },
  issue_refunds: { label: 'Issue refunds', description: 'Record/issue refunds for membership or events.' },
  create_paid_events: { label: 'Create paid events', description: 'Publish events that require payment.' },
  manage_events: { label: 'Manage events', description: 'Create and manage org events.' },
  manage_sponsors: { label: 'Manage sponsors', description: 'Add and manage sponsor listings.' },
  manage_referrals: { label: 'Manage referrals', description: 'Record and manage referral tracking.' },
  award_achievements: { label: 'Award achievements', description: 'Grant achievements to members.' },
  create_announcements: { label: 'Create announcements', description: 'Publish announcements (and free events where supported).' },
  pin_posts: { label: 'Pin posts', description: 'Pin important posts in org views.' },
  moderate_content: { label: 'Moderate content', description: 'Remove or moderate posts/comments where applicable.' },
}

type OrgJoinMode = (typeof ORG_JOIN_MODE_OPTIONS)[number]
type OrgMembershipStatus = (typeof ORG_MEMBERSHIP_STATUS_OPTIONS)[number]
type OrgRankVisibility = 'PUBLIC' | 'PRIVATE'
type OrgPlanType = 'FREE' | 'ONE_TIME' | 'SUBSCRIPTION'
type OrgPlanInterval = 'monthly' | 'yearly'

type GovernanceRankSummary = {
  id: string
  name: string
  description?: string | null
  permissions?: string[]
  visibility?: string
  system?: boolean
}

function toggleListValue(list: string[], value: string, nextOn: boolean) {
  const has = list.includes(value)
  if (nextOn) return has ? list : [...list, value]
  return has ? list.filter((item) => item !== value) : list
}

function normalizeRichText(value: string | null | undefined): string {
  const source = (value ?? '').trim()
  if (!source) return ''
  const textOnly = source.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim()
  return textOnly ? source : ''
}

async function waitForAssetReady(token: string, assetId: string, label: string) {
  const POLL_MAX_ATTEMPTS = 30
  const POLL_DELAY_MS = 3000

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(assetId)}`), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as MediaAssetStatusResponse | null
      const status = payload?.asset?.status
      if (status === 'ready') return true
      if (status === 'failed') {
        const reason = payload?.asset?.failureReason ? ` (${payload.asset.failureReason})` : ''
        throw new Error(`Your ${label} could not be processed${reason}.`)
      }
    }

    await new Promise((r) => setTimeout(r, POLL_DELAY_MS))
  }

  throw new Error(`Your ${label} is taking longer than expected to process. Please refresh in a moment.`)
}

export type OrganizationSettingsSection = 'all' | 'details' | 'governance' | 'roles'

export default function OrganizationSettingsClient({
  province,
  municipality,
  slug,
  initialOrg = null,
  section = 'all',
}: {
  province: string
  municipality: string
  slug: string
  initialOrg?: CommunityOrganization | null
  section?: OrganizationSettingsSection
}) {
  const router = useRouter()
  const [org, setOrg] = useState<CommunityOrganization | null>(initialOrg)
  const [me, setMe] = useState<MeResponse | null>(null)
  const cachedMe = useViewerStore((s) => s.me)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const showDetails = section === 'all' || section === 'details'
  const showGovernance = section === 'all' || section === 'governance'
  const showRoles = section === 'all' || section === 'roles'
  const showPeople = section === 'all'

  const [details, setDetails] = useState({
    phone: '',
    websiteUrl: '',
    addressDetails: createEmptyCanadianAddress() as CanadianAddress,
    schedule: '',
  })
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [organizationType, setOrganizationType] = useState<OrganizationTypeValue>('LOCAL_BUSINESS')
  const [organizationNameSaving, setOrganizationNameSaving] = useState(false)
  const [profileHeadline, setProfileHeadline] = useState('')
  const [profileAbout, setProfileAbout] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [members, setMembers] = useState<OrgMemberItem[]>([])
  const [followers, setFollowers] = useState<OrgFollowerItem[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null)
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [privateVisibilityModalOpen, setPrivateVisibilityModalOpen] = useState(false)
  const [auditItems, setAuditItems] = useState<OrgAuditItem[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [governanceState, setGovernanceState] = useState<OrgGovernanceStateResponse['state'] | null>(null)
  const [governanceAnalytics, setGovernanceAnalytics] = useState<OrgGovernanceAnalyticsResponse['summary'] | null>(null)
  const [governanceLoading, setGovernanceLoading] = useState(false)
  const [governanceActionBusy, setGovernanceActionBusy] = useState<string | null>(null)
  const [referrerUserId, setReferrerUserId] = useState('')
  const [referredUserId, setReferredUserId] = useState('')
  const [referralPlanId, setReferralPlanId] = useState('')
  const [reputationUserId, setReputationUserId] = useState('')
  const [reputationDelta, setReputationDelta] = useState('10')
  const [reputationSource, setReputationSource] = useState('manual_adjustment')
  const [reputationNote, setReputationNote] = useState('')
  const [rsvpEventId, setRsvpEventId] = useState('')
  const [rsvpStatus, setRsvpStatus] = useState<'GOING' | 'INTERESTED' | 'DECLINED'>('GOING')
  const [rsvpTicketType, setRsvpTicketType] = useState<'FREE' | 'PAID'>('FREE')
  const [economicsKind, setEconomicsKind] = useState<'membership' | 'event' | 'refund' | 'manual'>('manual')
  const [economicsAmountCents, setEconomicsAmountCents] = useState('0')
  const [economicsCurrency, setEconomicsCurrency] = useState('CAD')
  const [economicsEventId, setEconomicsEventId] = useState('')
  const [economicsMemberUserId, setEconomicsMemberUserId] = useState('')
  const [economicsNote, setEconomicsNote] = useState('')

  const [joinMode, setJoinMode] = useState<OrgJoinMode>('PUBLIC')
  const [joinModeReason, setJoinModeReason] = useState('')

  const [rankName, setRankName] = useState('')
  const [rankDescription, setRankDescription] = useState('')
  const [rankVisibility, setRankVisibility] = useState<OrgRankVisibility>('PUBLIC')
  const [rankPermissions, setRankPermissions] = useState<string[]>([])
  const [rankPromotionAuthority, setRankPromotionAuthority] = useState('')

  const [existingRankId, setExistingRankId] = useState<string>('')

  const [planName, setPlanName] = useState('')
  const [planDescription, setPlanDescription] = useState('')
  const [planType, setPlanType] = useState<OrgPlanType>('FREE')
  const [planAmountCents, setPlanAmountCents] = useState('0')
  const [planCurrency, setPlanCurrency] = useState('CAD')
  const [planInterval, setPlanInterval] = useState<OrgPlanInterval>('monthly')
  const [planRankId, setPlanRankId] = useState('')
  const [planGovernanceRights, setPlanGovernanceRights] = useState(false)

  const [sponsorName, setSponsorName] = useState('')
  const [sponsorTier, setSponsorTier] = useState('Bronze')
  const [sponsorLogoUrl, setSponsorLogoUrl] = useState('')
  const [sponsorRelationshipDescription, setSponsorRelationshipDescription] = useState('')
  const [sponsorCivilHandle, setSponsorCivilHandle] = useState('')
  const [sponsorLinkUrl, setSponsorLinkUrl] = useState('')
  const [sponsorLinkLabel, setSponsorLinkLabel] = useState('')

  const [achievementTitle, setAchievementTitle] = useState('')
  const [achievementDescription, setAchievementDescription] = useState('')
  const [achievementReputationPoints, setAchievementReputationPoints] = useState('0')
  const [achievementVisibility, setAchievementVisibility] = useState<OrgRankVisibility>('PUBLIC')

  const [awardAchievementId, setAwardAchievementId] = useState('')
  const [awardUserId, setAwardUserId] = useState('')
  const [awardNote, setAwardNote] = useState('')

  const [memberStatusUserId, setMemberStatusUserId] = useState('')
  const [memberStatusStatus, setMemberStatusStatus] = useState<OrgMembershipStatus>('ACTIVE')
  const [memberStatusRankId, setMemberStatusRankId] = useState('')
  const [memberStatusPlanId, setMemberStatusPlanId] = useState('')
  const [memberStatusReason, setMemberStatusReason] = useState('')

  const [photoModalCategory, setPhotoModalCategory] = useState<BusinessMediaCategory | null>(null)
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoPosting, setPhotoPosting] = useState(false)
  const [drafts, setDrafts] = useState<Record<BusinessMediaCategory, PhotoDraftState>>(() => ({
    business_logo: createPhotoDraftState(),
    business_cover: createPhotoDraftState(),
  }))
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const [token, setToken] = useState<string | null>(null)
  const [tokenReady, setTokenReady] = useState(false)
  const canManage = Boolean(org?.viewerRole === 'OWNER' || org?.viewerRole === 'MANAGER' || (me?.id && org?.ownerId && me.id === org.ownerId))
  const isOwner = Boolean(org?.viewerRole === 'OWNER' || (me?.id && org?.ownerId && me.id === org.ownerId))
  const normalizedOrganizationSlug = organizationSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  const canSaveOrganizationIdentity = Boolean(
    isOwner &&
      org &&
      organizationName.trim().length >= 3 &&
      (organizationName.trim() !== org.name ||
        organizationType !== org.type ||
        (org.status === 'DRAFT' && normalizedOrganizationSlug.length >= 1 && normalizedOrganizationSlug !== org.slug)),
  )
  const profileHeadlineTrimmed = profileHeadline.trim().slice(0, HEADLINE_MAX_CHARS)
  const profileAboutNormalized = normalizeRichText(profileAbout)
  const canSaveProfile = Boolean(
    org &&
      (profileHeadlineTrimmed !== (org.headline ?? '').trim() ||
        profileAboutNormalized !== normalizeRichText(org.description)),
  )
  const deleteConfirmationMatches = Boolean(org && deleteConfirmName.trim() === org.name.trim())

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(org?.slug ?? slug)}`
  }, [municipality, org?.slug, province, slug])

  useEffect(() => {
    setToken(getStoredToken())
    setTokenReady(true)
  }, [])

  const loadMembers = useCallback(async () => {
    if (!tokenReady) return
    if (!token) {
      setMembers([])
      setFollowers([])
      return
    }
    setMembersLoading(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/members`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setMembers([])
        setFollowers([])
        return
      }
      const { json } = await parseApiResponse<OrgMembersResponse>(res)
      setMembers(Array.isArray(json?.members) ? json.members : [])
      setFollowers(Array.isArray(json?.followers) ? json.followers : [])
    } catch {
      setMembers([])
      setFollowers([])
    } finally {
      setMembersLoading(false)
    }
  }, [orgApiPath, token, tokenReady])

  const loadAudit = useCallback(async () => {
    if (!tokenReady) return
    if (!token) {
      setAuditItems([])
      return
    }

    setAuditLoading(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/audit?limit=25`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setAuditItems([])
        return
      }
      const { json } = await parseApiResponse<OrgAuditResponse>(res)
      setAuditItems(Array.isArray(json?.items) ? json.items : [])
    } catch {
      setAuditItems([])
    } finally {
      setAuditLoading(false)
    }
  }, [orgApiPath, token, tokenReady])

  const loadGovernanceOverview = useCallback(async () => {
    if (!tokenReady) return
    if (!token) {
      setGovernanceState(null)
      setGovernanceAnalytics(null)
      return
    }

    setGovernanceLoading(true)
    try {
      const [stateRes, analyticsRes] = await Promise.all([
        fetch(buildApiUrl(`${orgApiPath}/governance/state`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(buildApiUrl(`${orgApiPath}/governance/analytics`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ])

      if (stateRes.ok) {
        const { json } = await parseApiResponse<OrgGovernanceStateResponse>(stateRes)
        setGovernanceState(json?.state ?? null)
      } else {
        setGovernanceState(null)
      }

      if (analyticsRes.ok) {
        const { json } = await parseApiResponse<OrgGovernanceAnalyticsResponse>(analyticsRes)
        setGovernanceAnalytics(json?.summary ?? null)
      } else {
        setGovernanceAnalytics(null)
      }
    } catch {
      setGovernanceState(null)
      setGovernanceAnalytics(null)
    } finally {
      setGovernanceLoading(false)
    }
  }, [orgApiPath, token, tokenReady])

  const load = useCallback(async () => {
    if (!tokenReady) return
    setLoading(true)
    try {
      if (token && cachedMe?.id) {
        setMe(cachedMe)
      }

      const [meData, orgRes] = await Promise.all([
        token && !cachedMe ? ensureViewerMe({ token }) : Promise.resolve(cachedMe),
        fetch(buildApiUrl(orgApiPath), { headers: token ? { authorization: `Bearer ${token}` } : undefined, cache: 'no-store' }),
      ])

      if (!token) {
        setMe(null)
      } else if (token && !cachedMe) {
        if (meData?.id) {
          setMe(meData)
        } else if (typeof window !== 'undefined' && !window.localStorage.getItem('token')) {
          setMe(null)
        }
      }

      if (orgRes.ok) {
        const payload = (await orgRes.json().catch(() => null)) as { org?: CommunityOrganization } | null
        setOrg((current) => payload?.org ?? current)
      }
    } finally {
      setLoading(false)
    }
  }, [cachedMe, orgApiPath, token, tokenReady])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  useEffect(() => {
    void loadGovernanceOverview()
  }, [loadGovernanceOverview])

  useEffect(() => {
    const next = typeof governanceState?.joinMode === 'string' ? governanceState.joinMode : null
    if (next && ORG_JOIN_MODE_OPTIONS.includes(next as OrgJoinMode)) {
      setJoinMode(next as OrgJoinMode)
    }
  }, [governanceState?.joinMode])

  const existingRanks = useMemo<GovernanceRankSummary[]>(() => {
    const ranks = Array.isArray(governanceState?.ranks) ? (governanceState?.ranks as GovernanceRankSummary[]) : []
    return [...ranks].sort((a, b) => {
      const aSystem = Boolean(a.system)
      const bSystem = Boolean(b.system)
      if (aSystem !== bSystem) return aSystem ? -1 : 1
      const aAdmins = String(a.name || '').toLowerCase() === 'admins'
      const bAdmins = String(b.name || '').toLowerCase() === 'admins'
      if (aAdmins !== bAdmins) return aAdmins ? -1 : 1
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }, [governanceState?.ranks])

  const selectedExistingRank = useMemo<GovernanceRankSummary | null>(() => {
    if (!existingRankId) return existingRanks[0] ?? null
    return existingRanks.find((rank) => rank?.id === existingRankId) ?? existingRanks[0] ?? null
  }, [existingRankId, existingRanks])

  useEffect(() => {
    if (existingRankId) return
    if (existingRanks.length) {
      const firstRank = existingRanks[0]
      if (firstRank) setExistingRankId(String(firstRank.id))
    }
  }, [existingRankId, existingRanks])

  useEffect(() => {
    if (!org) return
    setOrganizationName(org.name)
    setOrganizationSlug(org.slug)
    setOrganizationType(org.type as OrganizationTypeValue)
    setProfileHeadline((org.headline ?? '').slice(0, HEADLINE_MAX_CHARS))
    setProfileAbout(org.description ?? '')
    setDetails({
      phone: org.phone ?? '',
      websiteUrl: org.websiteUrl ?? '',
      addressDetails: normalizeCanadianAddress(org.addressDetails ?? null),
      schedule: org.schedule ?? '',
    })
    setDetailsDirty(false)
    setDeleteConfirmName('')
  }, [org])

  const saveDetails = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org) return

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phone: details.phone.trim() ? details.phone.trim() : null,
          websiteUrl: details.websiteUrl.trim() ? details.websiteUrl.trim() : null,
          addressDetails: hasCanadianAddressValue(details.addressDetails) ? normalizeCanadianAddress(details.addressDetails) : null,
          schedule: details.schedule.trim() ? details.schedule.trim() : null,
        }),
      })

      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only organization admins can edit these settings.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to save organization details right now.', 'error')
        }
        return
      }

      setOrg(json?.org ?? org)
      setDetailsDirty(false)
      pushToast('Saved organization details.', 'success')
    } catch (err) {
      console.error('Failed to save organization details', err)
      pushToast('Unable to save organization details right now.', 'error')
    } finally {
      setSaving(false)
    }
  }, [details.addressDetails, details.phone, details.schedule, details.websiteUrl, org, orgApiPath, token])

  const saveOrganizationIdentity = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org || !isOwner) return

    const nextName = organizationName.trim()
    if (nextName.length < 3) {
      pushToast('Organization name must be at least 3 characters.', 'error')
      return
    }
    if (org.status === 'DRAFT' && !normalizedOrganizationSlug) {
      pushToast('Organization URL must contain at least one letter or number.', 'error')
      return
    }
    if (!canSaveOrganizationIdentity) return

    setOrganizationNameSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (nextName !== org.name) body.name = nextName
      if (organizationType !== org.type) body.type = organizationType
      if (org.status === 'DRAFT' && normalizedOrganizationSlug && normalizedOrganizationSlug !== org.slug) {
        body.slug = normalizedOrganizationSlug
      }

      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only the organization owner can update organization identity.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to save organization identity right now.', 'error')
        }
        return
      }

      if (json?.org) {
        const nextOrg = json.org
        const slugChanged = nextOrg.slug !== org.slug
        setOrg(nextOrg)
        setOrganizationName(nextOrg.name)
        setOrganizationSlug(nextOrg.slug)
        setOrganizationType(nextOrg.type as OrganizationTypeValue)
        if (slugChanged) {
          router.replace(`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(nextOrg.slug)}/settings/details`)
        }
      }
      pushToast('Organization identity saved.', 'success')
    } catch (err) {
      console.error('Failed to save organization identity', err)
      pushToast('Unable to save organization identity right now.', 'error')
    } finally {
      setOrganizationNameSaving(false)
    }
  }, [canSaveOrganizationIdentity, isOwner, municipality, normalizedOrganizationSlug, org, orgApiPath, organizationName, organizationType, province, router, token])

  const saveProfileDetails = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org) return

    setProfileSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          headline: profileHeadlineTrimmed || null,
          description: profileAboutNormalized || null,
        }),
      })

      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only organization admins can edit profile details.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to save organization profile right now.', 'error')
        }
        return
      }

      if (json?.org) setOrg(json.org)
      pushToast('Saved organization profile.', 'success')
    } catch (err) {
      console.error('Failed to save organization profile', err)
      pushToast('Unable to save organization profile right now.', 'error')
    } finally {
      setProfileSaving(false)
    }
  }, [org, orgApiPath, profileAboutNormalized, profileHeadlineTrimmed, token])

  const closeDeleteModal = useCallback(() => {
    if (deleteSaving) return
    setDeleteModalOpen(false)
    setDeleteConfirmName('')
  }, [deleteSaving])

  const deleteOrganization = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org || !canManage) return
    if (!deleteConfirmationMatches) {
      pushToast('Type the organization name to confirm deletion.', 'error')
      return
    }

    setDeleteSaving(true)
    try {
      const res = await fetch(buildApiUrl(orgApiPath), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      const { json } = await parseApiResponse<{ error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only organization admins can delete this organization.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to delete this organization right now.', 'error')
        }
        return
      }

      setDeleteModalOpen(false)
      setDeleteConfirmName('')
      pushToast('Organization marked as deleted.', 'success')
      router.push('/organizations/manager')
    } catch (err) {
      console.error('Failed to delete organization', err)
      pushToast('Unable to delete this organization right now.', 'error')
    } finally {
      setDeleteSaving(false)
    }
  }, [canManage, deleteConfirmationMatches, org, orgApiPath, router, token])

  const updateVisibility = useCallback(async (nextPublic: boolean) => {
    if (!token || !org || !canManage) return
    setVisibilitySaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPublic: nextPublic }),
      })
      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        const rawError =
          typeof (json as any)?.error === 'string'
            ? (json as any).error
            : typeof (json as any)?.error?.message === 'string'
              ? (json as any).error.message
              : null
        pushToast(rawError ?? 'Unable to update visibility right now.', 'error')
        return
      }
      if (json?.org) setOrg(json.org)
      if (!nextPublic) {
        setPrivateVisibilityModalOpen(false)
      }
      pushToast(nextPublic ? 'Organization is now public.' : 'Organization is now private.', 'success')
    } catch {
      pushToast('Unable to update visibility right now.', 'error')
    } finally {
      setVisibilitySaving(false)
    }
  }, [canManage, org, orgApiPath, token])

  const promoteFollower = useCallback(
    async (targetUserId: string) => {
      if (!token || !isOwner) return
      setMemberActionUserId(targetUserId)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/members/${encodeURIComponent(targetUserId)}/promote`), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const { json } = await parseApiResponse<{ error?: unknown }>(res)
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to promote this member right now.', 'error')
          return
        }
        pushToast('Promoted to manager.', 'success')
        await loadMembers()
      } catch {
        pushToast('Unable to promote this member right now.', 'error')
      } finally {
        setMemberActionUserId(null)
      }
    },
    [isOwner, loadMembers, orgApiPath, token],
  )

  const removeMember = useCallback(
    async (targetUserId: string) => {
      if (!token || !isOwner) return
      setMemberActionUserId(targetUserId)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/members/${encodeURIComponent(targetUserId)}`), {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const { json } = await parseApiResponse<{ error?: unknown }>(res)
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to remove this member right now.', 'error')
          return
        }
        pushToast('Member removed.', 'success')
        await loadMembers()
      } catch {
        pushToast('Unable to remove this member right now.', 'error')
      } finally {
        setMemberActionUserId(null)
      }
    },
    [isOwner, loadMembers, orgApiPath, token],
  )

  const refreshGovernanceData = useCallback(async () => {
    await Promise.all([loadGovernanceOverview(), loadAudit()])
  }, [loadAudit, loadGovernanceOverview])

  const postGovernanceAction = useCallback(
    async ({
      key,
      endpoint,
      payload,
      successMessage,
    }: {
      key: string
      endpoint: string
      payload: Record<string, unknown>
      successMessage: string
    }) => {
      if (!token) {
        redirectToAuthModal('login')
        return false
      }

      setGovernanceActionBusy(key)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}${endpoint}`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        const { json } = await parseApiResponse<{ error?: unknown }>(res)
        if (!res.ok) {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Governance action failed.', 'error')
          return false
        }

        pushToast(successMessage, 'success')
        await refreshGovernanceData()
        return true
      } catch {
        pushToast('Governance action failed.', 'error')
        return false
      } finally {
        setGovernanceActionBusy(null)
      }
    },
    [orgApiPath, refreshGovernanceData, token],
  )

  const submitReferral = useCallback(async () => {
    if (!referrerUserId.trim() || !referredUserId.trim()) {
      pushToast('Referrer and referred user IDs are required.', 'error')
      return
    }

    const ok = await postGovernanceAction({
      key: 'referral',
      endpoint: '/governance/referrals',
      payload: {
        referrerUserId: referrerUserId.trim(),
        referredUserId: referredUserId.trim(),
        planId: referralPlanId.trim() || null,
      },
      successMessage: 'Referral recorded.',
    })

    if (ok) {
      setReferredUserId('')
    }
  }, [postGovernanceAction, referredUserId, referrerUserId, referralPlanId])

  const submitReputation = useCallback(async () => {
    if (!reputationUserId.trim()) {
      pushToast('User ID is required for reputation updates.', 'error')
      return
    }

    const deltaNumber = Number(reputationDelta)
    if (!Number.isFinite(deltaNumber) || !Number.isInteger(deltaNumber)) {
      pushToast('Reputation delta must be an integer.', 'error')
      return
    }

    await postGovernanceAction({
      key: 'reputation',
      endpoint: '/governance/reputation',
      payload: {
        userId: reputationUserId.trim(),
        delta: deltaNumber,
        source: reputationSource.trim() || 'manual_adjustment',
        note: reputationNote.trim() || null,
      },
      successMessage: 'Reputation updated.',
    })
  }, [postGovernanceAction, reputationDelta, reputationNote, reputationSource, reputationUserId])

  const submitRsvp = useCallback(async () => {
    if (!rsvpEventId.trim()) {
      pushToast('Event ID is required for RSVP.', 'error')
      return
    }

    await postGovernanceAction({
      key: 'rsvp',
      endpoint: `/governance/events/${encodeURIComponent(rsvpEventId.trim())}/rsvp`,
      payload: {
        status: rsvpStatus,
        ticketType: rsvpTicketType,
      },
      successMessage: 'RSVP updated.',
    })
  }, [postGovernanceAction, rsvpEventId, rsvpStatus, rsvpTicketType])

  const submitEconomicsRecord = useCallback(async () => {
    const amountNumber = Number(economicsAmountCents)
    if (!Number.isFinite(amountNumber) || !Number.isInteger(amountNumber)) {
      pushToast('Amount must be an integer in cents.', 'error')
      return
    }
    if (economicsKind === 'event' && !economicsEventId.trim()) {
      pushToast('Event ID is required for event economics records.', 'error')
      return
    }

    await postGovernanceAction({
      key: 'economics',
      endpoint: '/governance/economics',
      payload: {
        kind: economicsKind,
        amountCents: amountNumber,
        currency: economicsCurrency.trim().toUpperCase() || 'CAD',
        memberUserId: economicsMemberUserId.trim() || null,
        eventId: economicsEventId.trim() || null,
        note: economicsNote.trim() || null,
      },
      successMessage: 'Economics record added.',
    })
  }, [economicsAmountCents, economicsCurrency, economicsEventId, economicsKind, economicsMemberUserId, economicsNote, postGovernanceAction])

  const submitJoinMode = useCallback(async () => {
    await postGovernanceAction({
      key: 'join-mode',
      endpoint: '/governance/join-mode',
      payload: {
        joinMode,
        reason: joinModeReason.trim() || null,
      },
      successMessage: 'Join mode updated.',
    })
  }, [joinMode, joinModeReason, postGovernanceAction])

  const submitRank = useCallback(async () => {
    if (!rankName.trim()) {
      pushToast('Rank name is required.', 'error')
      return
    }
    if (!rankPermissions.length) {
      pushToast('Select at least one permission.', 'error')
      return
    }

    const promotionAuthority = rankPromotionAuthority
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    const ok = await postGovernanceAction({
      key: 'rank',
      endpoint: '/governance/ranks',
      payload: {
        name: rankName.trim(),
        description: rankDescription.trim() || null,
        permissions: rankPermissions,
        visibility: rankVisibility,
        promotionAuthority: promotionAuthority.length ? promotionAuthority : undefined,
      },
      successMessage: 'Rank created.',
    })

    if (ok) {
      setRankName('')
      setRankDescription('')
      setRankPromotionAuthority('')
    }
  }, [postGovernanceAction, rankDescription, rankName, rankPermissions, rankPromotionAuthority, rankVisibility])

  const submitPlan = useCallback(async () => {
    if (!planName.trim()) {
      pushToast('Plan name is required.', 'error')
      return
    }

    const amountNumber = Number(planAmountCents)
    if (planType !== 'FREE') {
      if (!Number.isFinite(amountNumber) || !Number.isInteger(amountNumber) || amountNumber <= 0) {
        pushToast('Amount cents must be a positive integer for paid plans.', 'error')
        return
      }
    }

    const ok = await postGovernanceAction({
      key: 'plan',
      endpoint: '/governance/plans',
      payload: {
        name: planName.trim(),
        description: planDescription.trim() || null,
        type: planType,
        amountCents: planType === 'FREE' ? undefined : amountNumber,
        currency: planCurrency.trim().toUpperCase() || 'CAD',
        interval: planType === 'SUBSCRIPTION' ? planInterval : null,
        rankId: planRankId.trim() || null,
        governanceRights: Boolean(planGovernanceRights),
      },
      successMessage: 'Plan created.',
    })

    if (ok) {
      setPlanName('')
      setPlanDescription('')
      setPlanType('FREE')
      setPlanAmountCents('0')
      setPlanCurrency('CAD')
      setPlanRankId('')
      setPlanGovernanceRights(false)
    }
  }, [planAmountCents, planCurrency, planDescription, planGovernanceRights, planInterval, planName, planRankId, planType, postGovernanceAction])

  const submitSponsor = useCallback(async () => {
    if (!sponsorName.trim() || !sponsorTier.trim()) {
      pushToast('Sponsor name and tier are required.', 'error')
      return
    }

    const handle = sponsorCivilHandle.trim().replace(/^@/, '')
    const linkUrlCandidate = handle ? `/u/${encodeURIComponent(handle)}` : sponsorLinkUrl.trim()
    const linkLabelCandidate = sponsorLinkLabel.trim() || (handle ? `@${handle}` : '')

    if (linkUrlCandidate) {
      const isInternalPath = linkUrlCandidate.startsWith('/')
      const isHttpUrl = /^https?:\/\//i.test(linkUrlCandidate)
      if (!isInternalPath && !isHttpUrl) {
        pushToast('Link URL must start with / (internal) or http(s):// (external).', 'error')
        return
      }
    }

    const ok = await postGovernanceAction({
      key: 'sponsor',
      endpoint: '/governance/sponsors',
      payload: {
        name: sponsorName.trim(),
        tier: sponsorTier.trim(),
        logoUrl: sponsorLogoUrl.trim() || null,
        relationshipDescription: sponsorRelationshipDescription.trim() || null,
        linkUrl: linkUrlCandidate || null,
        linkLabel: linkLabelCandidate || null,
      },
      successMessage: 'Sponsor added.',
    })

    if (ok) {
      setSponsorName('')
      setSponsorTier('Bronze')
      setSponsorLogoUrl('')
      setSponsorRelationshipDescription('')
      setSponsorCivilHandle('')
      setSponsorLinkUrl('')
      setSponsorLinkLabel('')
    }
  }, [postGovernanceAction, sponsorCivilHandle, sponsorLinkLabel, sponsorLinkUrl, sponsorLogoUrl, sponsorName, sponsorRelationshipDescription, sponsorTier])

  const submitAchievement = useCallback(async () => {
    if (!achievementTitle.trim()) {
      pushToast('Achievement title is required.', 'error')
      return
    }
    const pointsNumber = Number(achievementReputationPoints)
    if (!Number.isFinite(pointsNumber) || !Number.isInteger(pointsNumber) || pointsNumber < 0) {
      pushToast('Reputation points must be a non-negative integer.', 'error')
      return
    }

    const ok = await postGovernanceAction({
      key: 'achievement',
      endpoint: '/governance/achievements',
      payload: {
        title: achievementTitle.trim(),
        description: achievementDescription.trim() || null,
        reputationPoints: pointsNumber,
        visibility: achievementVisibility,
      },
      successMessage: 'Achievement created.',
    })

    if (ok) {
      setAchievementTitle('')
      setAchievementDescription('')
      setAchievementReputationPoints('0')
      setAchievementVisibility('PUBLIC')
    }
  }, [achievementDescription, achievementReputationPoints, achievementTitle, achievementVisibility, postGovernanceAction])

  const submitAchievementAward = useCallback(async () => {
    if (!awardAchievementId.trim() || !awardUserId.trim()) {
      pushToast('Achievement ID and user ID are required.', 'error')
      return
    }

    const ok = await postGovernanceAction({
      key: 'award',
      endpoint: `/governance/achievements/${encodeURIComponent(awardAchievementId.trim())}/award`,
      payload: {
        userId: awardUserId.trim(),
        note: awardNote.trim() || null,
      },
      successMessage: 'Achievement awarded.',
    })

    if (ok) {
      setAwardUserId('')
      setAwardNote('')
    }
  }, [awardAchievementId, awardNote, awardUserId, postGovernanceAction])

  const submitMemberStatus = useCallback(async () => {
    if (!memberStatusUserId.trim()) {
      pushToast('User ID is required.', 'error')
      return
    }

    const ok = await postGovernanceAction({
      key: 'member-status',
      endpoint: `/governance/members/${encodeURIComponent(memberStatusUserId.trim())}/status`,
      payload: {
        status: memberStatusStatus,
        rankId: memberStatusRankId.trim() || null,
        planId: memberStatusPlanId.trim() || null,
        reason: memberStatusReason.trim() || null,
      },
      successMessage: 'Member status updated.',
    })

    if (ok) {
      setMemberStatusReason('')
    }
  }, [memberStatusPlanId, memberStatusRankId, memberStatusReason, memberStatusStatus, memberStatusUserId, postGovernanceAction])

  const updateDraft = useCallback((category: BusinessMediaCategory, updater: (prev: PhotoDraftState) => PhotoDraftState) => {
    setDrafts((prev) => ({ ...prev, [category]: updater(prev[category]) }))
  }, [])

  const launchPhotoFlow = useCallback((category: BusinessMediaCategory, triggerPicker = true) => {
    setPhotoModalCategory(category)
    setPhotoCaption('')
    setUploadError(null)
    setUploadStatus('idle')
    if (triggerPicker) {
      setTimeout(() => {
        const ref = category === 'business_logo' ? logoInputRef : coverInputRef
        ref.current?.click()
      }, 0)
    }
  }, [])

  const closePhotoModal = useCallback(() => {
    setPhotoModalCategory(null)
    setPhotoCaption('')
    setUploadError(null)
    setUploadStatus('idle')
    setPhotoPosting(false)
  }, [])

  const openFilePicker = useCallback((category: BusinessMediaCategory) => {
    const ref = category === 'business_logo' ? logoInputRef : coverInputRef
    ref.current?.click()
  }, [])

  const handleCropChange = useCallback(
    (category: BusinessMediaCategory) => (nextCrop: { x: number; y: number }) => {
      updateDraft(category, (prev) => ({ ...prev, crop: nextCrop, isDirty: true }))
    },
    [updateDraft],
  )

  const handleZoomChange = useCallback(
    (category: BusinessMediaCategory) => (nextZoom: number) => {
      updateDraft(category, (prev) => ({ ...prev, zoom: nextZoom, isDirty: true }))
    },
    [updateDraft],
  )

  const handleCropComplete = useCallback(
    (category: BusinessMediaCategory) => (_area: Area, nextAreaPixels: Area) => {
      updateDraft(category, (prev) => ({ ...prev, croppedAreaPixels: nextAreaPixels, isDirty: true }))
    },
    [updateDraft],
  )

  const resetPhotoDraftCrop = useCallback(
    (category: BusinessMediaCategory) => {
      updateDraft(category, (prev) => ({ ...prev, crop: { x: 0, y: 0 }, zoom: 1, croppedAreaPixels: null, isDirty: Boolean(prev.file) }))
    },
    [updateDraft],
  )

  const safeParseAbsoluteUrl = useCallback((candidate: string | null | undefined): URL | null => {
    if (!candidate) return null
    try {
      return new URL(candidate)
    } catch {
      return null
    }
  }, [])

  const uploadViaMediaApi = useCallback(
    async (category: keyof typeof MEDIA_LIMITS, file: File) => {
      if (!token) {
        pushToast('You must be signed in to upload organization photos.', 'error')
        redirectToAuthModal('login')
        return null
      }

      const limit = MEDIA_LIMITS[category]
      if (file.size > limit) {
        pushToast(`That file is too large. Max size is ${(limit / MB).toFixed(0)}MB.`, 'error')
        return null
      }

      if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
        return null
      }

      setUploadStatus('uploading')
      setUploadError(null)

      const dimensions = await readImageDimensions(file)

      const initRes = await fetch(buildApiUrl('/media/uploads'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category,
          mime: file.type || 'application/octet-stream',
          byteSize: file.size,
          filename: file.name,
        }),
      })

      if (!initRes.ok) {
        const { json } = await parseApiResponse<{ error?: unknown }>(initRes)
        console.warn('Upload init failed', json)
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      const initPayload = (await initRes.json().catch(() => null)) as MediaUploadInitResponse | null
      const assetId = initPayload?.assetId
      if (!assetId) {
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      let uploaded = false
      const directUrl = safeParseAbsoluteUrl(initPayload?.upload?.url)
      if (directUrl) {
        try {
          const res = await fetch(directUrl.toString(), {
            method: 'PUT',
            headers: {
              ...(initPayload?.upload?.headers ?? {}),
              'content-type': file.type || 'application/octet-stream',
            },
            body: file,
          })
          uploaded = res.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded && initPayload?.proxyPath) {
        const proxyRes = await fetch(buildApiUrl(initPayload.proxyPath), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.type || 'application/octet-stream',
            'x-upload-byte-size': String(file.size),
          },
          body: file,
        })
        uploaded = proxyRes.ok
      }

      if (!uploaded) {
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          assetId,
          width: dimensions?.width,
          height: dimensions?.height,
        }),
      })
      if (!completeRes.ok) {
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      setUploadStatus('processing')
      try {
        await waitForAssetReady(token, assetId, 'photo')
      } catch (err) {
        setUploadStatus('error')
        setUploadError(err instanceof Error ? err.message : 'Upload failed.')
        return null
      }

      setUploadStatus('ready')
      return assetId
    },
    [safeParseAbsoluteUrl, token],
  )

  const applyPhotoCrop = useCallback(
    async (category: BusinessMediaCategory) => {
      const draft = drafts[category]
      if (!draft.file) {
        pushToast('Upload a photo before posting.', 'error')
        return null
      }

      const desiredAspect = category === 'business_logo' ? 1 : COVER_ASPECT_RATIO
      let cropArea = draft.croppedAreaPixels
      if (!cropArea) {
        const dims = await readImageDimensions(draft.file)
        if (!dims) {
          pushToast('We could not read that photo. Please choose a different one.', 'error')
          return null
        }
        const fallbackArea = computeFallbackCropArea(dims, desiredAspect)
        cropArea = fallbackArea
        updateDraft(category, (prev) => ({ ...prev, croppedAreaPixels: fallbackArea }))
      }

      const exportOptions =
        category === 'business_logo'
          ? { width: LOGO_EXPORT_SIZE, height: LOGO_EXPORT_SIZE, mime: 'image/jpeg' as const, quality: 0.92 }
          : { width: COVER_EXPORT_WIDTH, height: COVER_EXPORT_HEIGHT, mime: 'image/jpeg' as const, quality: 0.92 }

      const blob = await generateCroppedImageBlob(draft.file, cropArea, exportOptions)
      if (!blob) {
        pushToast('We could not crop that image. Please try again with a different photo.', 'error')
        return null
      }

      const baseName = draft.file.name?.replace(/\.[^/.]+$/, '') || category
      const croppedFile = new File([blob], `${baseName}-${category}.jpg`, { type: blob.type || 'image/jpeg' })

      const displayAssetId = await uploadViaMediaApi(category, croppedFile)
      if (displayAssetId) {
        updateDraft(category, (prev) => ({ ...prev, isDirty: false }))
      }
      return displayAssetId
    },
    [drafts, updateDraft, uploadViaMediaApi],
  )

  const ensureFullSizeAsset = useCallback(
    async (category: BusinessMediaCategory, displayAssetId: string) => {
      const draft = drafts[category]
      if (draft.file) {
        if (draft.fullAssetId) return draft.fullAssetId
        const fullAssetId = await uploadViaMediaApi('post_image', draft.file)
        if (!fullAssetId) return null
        updateDraft(category, (prev) => ({ ...prev, fullAssetId }))
        return fullAssetId
      }
      return displayAssetId
    },
    [drafts, updateDraft, uploadViaMediaApi],
  )

  const ensurePhotoApplied = useCallback(
    async (category: BusinessMediaCategory) => {
      const draft = drafts[category]
      if (draft.file && draft.isDirty) {
        return await applyPhotoCrop(category)
      }
      return null
    },
    [applyPhotoCrop, drafts],
  )

  const handlePostPhoto = useCallback(async () => {
    if (!photoModalCategory) return
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setPhotoPosting(true)
    setSaving(true)
    try {
      const displayAssetId = await ensurePhotoApplied(photoModalCategory)
      if (!displayAssetId) {
        pushToast('Upload a photo before posting.', 'error')
        return
      }

      const fullAssetId = await ensureFullSizeAsset(photoModalCategory, displayAssetId)
      if (!fullAssetId) return

      const res = await fetch(buildApiUrl(`${orgApiPath}/profile-photo`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: photoModalCategory,
          displayAssetId,
          fullAssetId,
          caption: photoCaption.trim() || undefined,
        }),
      })

      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const rawError = typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.message === 'string' ? payload.error.message : null
        if (res.status === 403) {
          pushToast('Only organization admins can update these photos.', 'error')
        } else {
          pushToast(rawError ?? 'Unable to update organization photo right now.', 'error')
        }
        return
      }

      pushToast('Updated organization photo (posted to feed).', 'success')
      setDrafts((prev) => ({
        ...prev,
        [photoModalCategory]: createPhotoDraftState(),
      }))
      closePhotoModal()
      await load()
    } catch (err) {
      console.error('Failed to update organization photo', err)
      pushToast('Unable to update organization photo right now.', 'error')
    } finally {
      setPhotoPosting(false)
      setSaving(false)
    }
  }, [closePhotoModal, ensureFullSizeAsset, ensurePhotoApplied, load, orgApiPath, photoCaption, photoModalCategory, token])

  const handleFileChange = useCallback(
    (category: BusinessMediaCategory) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        const limit = MEDIA_LIMITS[category]
        if (file.size > limit) {
          pushToast(`That file is too large. Max size is ${(limit / MB).toFixed(0)}MB.`, 'error')
          return
        }
        if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
          pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
          return
        }

        const previewUrl = URL.createObjectURL(file)
        updateDraft(category, (prev) => {
          if (prev.previewUrl && prev.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(prev.previewUrl)
          }
          return {
            ...prev,
            file,
            previewUrl,
            crop: { x: 0, y: 0 },
            zoom: 1,
            croppedAreaPixels: null,
            isDirty: true,
            fullAssetId: null,
          }
        })
      },
    [updateDraft],
  )

  useEffect(() => {
    return () => {
      const urls = [drafts.business_logo.previewUrl, drafts.business_cover.previewUrl]
      for (const url of urls) {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
      }
    }
  }, [drafts.business_cover.previewUrl, drafts.business_logo.previewUrl])

  const logoDisplayUrl = org?.logoUrl ?? null
  const coverDisplayUrl = org?.coverUrl ?? null

  if (loading || !tokenReady) {
    return <p className="text-sm text-slate-600">Loading…</p>
  }

  if (!token) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">You must be signed in to edit organization settings.</p>
        <button
          type="button"
          onClick={() => redirectToAuthModal('login')}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Sign in
        </button>
      </div>
    )
  }

  if (!org) {
    return <p className="text-sm text-slate-600">Organization not found.</p>
  }

  if (!canManage) {
    return <p className="text-sm text-slate-600">Only organization admins can edit these settings.</p>
  }

  const currentCategory = photoModalCategory ?? 'business_logo'
  const activeDraft = photoModalCategory ? drafts[photoModalCategory] : null
  const modalTitle = currentCategory === 'business_logo' ? 'Update organization profile photo' : 'Update organization cover photo'
  const modalPreview =
    activeDraft?.previewUrl ?? (currentCategory === 'business_logo' ? org.logoUrl ?? null : org.coverUrl ?? null)
  const canSubmitPhoto = Boolean(photoModalCategory && activeDraft?.file)

  return (
    <div className="space-y-8">
      <Modal open={deleteModalOpen} onClose={closeDeleteModal} title="Delete organization">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            This marks the organization as deleted and hides it from public discovery. Organization posts will also be marked deleted.
          </p>
          <p className="text-xs text-slate-500">
            Type <span className="font-semibold text-slate-700">{org.name}</span> to confirm.
          </p>
          <input
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            disabled={deleteSaving}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder={org.name}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={deleteSaving}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteOrganization}
              disabled={deleteSaving || !deleteConfirmationMatches}
              className="rounded-full border border-rose-300 bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteSaving ? 'Deleting…' : 'Delete organization'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={privateVisibilityModalOpen} onClose={() => setPrivateVisibilityModalOpen(false)} title="Make organization private?">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Making your organization private hides it from public discovery, but you can switch it back to public at any time.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            <li>Your organization will not be searchable.</li>
            <li>Organization posts will not be visible in communities.</li>
            <li>Only organization admins can see and manage it.</li>
          </ul>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPrivateVisibilityModalOpen(false)}
              disabled={visibilitySaving}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void updateVisibility(false)}
              disabled={visibilitySaving}
              className="rounded-full border border-amber-300 bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {visibilitySaving ? 'Saving…' : 'Make private'}
            </button>
          </div>
        </div>
      </Modal>

      <PhotoUpdateModal
        open={Boolean(photoModalCategory)}
        title={modalTitle}
        subtitle="Share a quick post when you refresh your photo."
        imageUrl={activeDraft?.previewUrl ? null : modalPreview}
        cropperImageUrl={activeDraft?.previewUrl ?? null}
        aspect={currentCategory === 'business_logo' ? 1 : COVER_ASPECT_RATIO}
        cropShape={currentCategory === 'business_logo' ? 'round' : 'rect'}
        showGrid={currentCategory !== 'business_logo'}
        crop={activeDraft?.crop ?? { x: 0, y: 0 }}
        zoom={activeDraft?.zoom ?? 1}
        maxZoom={MAX_CROP_ZOOM}
        onCropChange={handleCropChange(currentCategory)}
        onZoomChange={handleZoomChange(currentCategory)}
        onCropComplete={handleCropComplete(currentCategory)}
        onResetPosition={() => resetPhotoDraftCrop(currentCategory)}
        onPickFile={() => openFilePicker(currentCategory)}
        uploadStatus={uploadStatus}
        uploadError={uploadError}
        caption={photoCaption}
        onCaptionChange={setPhotoCaption}
        primaryLabel="Post update"
        primaryDisabled={photoPosting || !canSubmitPhoto}
        primaryLoading={photoPosting}
        onPrimary={handlePostPhoto}
        onClose={closePhotoModal}
      />

      {showDetails ? (
      <section className="surface-card space-y-6 p-6 shadow-subtle">
        <header className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Photos</h3>
          <p className="text-sm text-slate-500">Upload a cover and profile photo to personalize this organization.</p>
        </header>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Cover photo</p>
              <p className="text-xs text-gray-500">Shown at the top of your public organization page.</p>
            </div>
            <button
              type="button"
              onClick={() => launchPhotoFlow('business_cover', true)}
              disabled={saving}
              className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              Upload new cover
            </button>
          </div>

          {coverDisplayUrl ? (
            <img src={coverDisplayUrl} alt={`${org.name} cover`} className="h-40 w-full rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              No cover photo yet.
            </div>
          )}

          <p className="mt-2 text-xs text-slate-500">Up to 20MB. Supported: JPG, PNG, WebP, AVIF, HEIC.</p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <VerifiedAvatar
            src={logoDisplayUrl}
            alt={org.name}
            initials={org.name}
            size={80}
            isVerified={Boolean(org.isVerified)}
            className="shrink-0"
          />
          <div className="space-y-1 text-sm text-gray-600">
            <button
              type="button"
              onClick={() => launchPhotoFlow('business_logo', true)}
              disabled={saving}
              className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              Upload new profile photo
            </button>
            <p className="text-xs text-slate-500">Up to 8MB. Supported: JPG, PNG, WebP, AVIF, HEIC.</p>
          </div>
        </div>

        <input
          ref={coverInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={handleFileChange('business_cover')}
        />
        <input
          ref={logoInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={handleFileChange('business_logo')}
        />
      </section>

      ) : null}

      {showDetails && isOwner ? (
        <section className="surface-card space-y-3 p-6 shadow-subtle">
          <h3 className="text-sm font-semibold text-slate-900">Organization identity</h3>
          <p className="text-xs text-slate-500">Set the public name, URL, and directory type before publishing your organization.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
              Organization name
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                disabled={organizationNameSaving}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
                placeholder="Organization name"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              URL slug
              <input
                value={organizationSlug}
                onChange={(e) => setOrganizationSlug(e.target.value)}
                disabled={organizationNameSaving || org.status !== 'DRAFT'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
                placeholder="civil-citizens-incorporated"
              />
              <span className="text-xs text-slate-500">
                {org.status === 'DRAFT'
                  ? `Preview: /com/${province}/${municipality}/orgs/${normalizedOrganizationSlug || 'your-organization'}`
                  : 'Organization URLs lock after publishing.'}
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Organization type
              <select
                value={organizationType}
                onChange={(e) => setOrganizationType(e.target.value as OrganizationTypeValue)}
                disabled={organizationNameSaving}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              >
                {ORGANIZATION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveOrganizationIdentity}
              disabled={!canSaveOrganizationIdentity || organizationNameSaving}
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {organizationNameSaving ? 'Saving…' : 'Save identity'}
            </button>
          </div>
        </section>
      ) : null}

      {showDetails ? (
      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Directory details</h3>
        <p className="text-xs text-slate-500">These appear on the organizations directory page.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Phone
            <input
              value={details.phone}
              onChange={(e) => {
                setDetails((prev) => ({ ...prev, phone: e.target.value }))
                setDetailsDirty(true)
              }}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="(optional)"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Website
            <input
              value={details.websiteUrl}
              onChange={(e) => {
                setDetails((prev) => ({ ...prev, websiteUrl: e.target.value }))
                setDetailsDirty(true)
              }}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="(optional)"
            />
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-700">Address</p>
            <p className="mt-1 text-xs text-slate-500">Use the structured Canadian address fields below so the public profile and map stay consistent.</p>
            {!hasCanadianAddressValue(details.addressDetails) && org?.address ? (
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Legacy address on file: {formatCanadianAddressInline({ line1: org.address }) ?? org.address}
              </p>
            ) : null}
          </div>

          <CanadianAddressEditor
            value={details.addressDetails}
            onChange={(next) => {
              setDetails((prev) => ({ ...prev, addressDetails: next }))
              setDetailsDirty(true)
            }}
            disabled={saving}
            mode="organization"
          />
        </div>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Schedule
          <textarea
            value={details.schedule}
            onChange={(e) => {
              setDetails((prev) => ({ ...prev, schedule: e.target.value }))
              setDetailsDirty(true)
            }}
            disabled={saving}
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="(optional)"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveDetails}
            disabled={saving || !detailsDirty}
            className="inline-flex items-center justify-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            Save details
          </button>
          <a
            href={`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop/manage`}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Manage shop
          </a>
        </div>
      </section>

      ) : null}

      {showDetails ? (
      <section className="surface-card space-y-4 p-6 shadow-subtle">
        <header className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Organization profile</h3>
          <p className="text-sm text-slate-500">This content appears on your public organization page.</p>
        </header>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Headline
          <input
            value={profileHeadline}
            onChange={(event) => setProfileHeadline(event.target.value.slice(0, HEADLINE_MAX_CHARS))}
            disabled={profileSaving}
            maxLength={HEADLINE_MAX_CHARS}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="Short headline (60 characters max)"
          />
          <span className="text-xs text-slate-500">{profileHeadline.length}/{HEADLINE_MAX_CHARS}</span>
        </label>

        <div className="grid gap-1">
          <span className="text-sm font-medium text-slate-700">About us</span>
          <RichTextEditor
            value={profileAbout}
            onChange={setProfileAbout}
            placeholder="Share your mission, values, and what this organization does."
            minHeight={220}
            disabled={profileSaving}
          />
          <p className="text-xs text-slate-500">Supports formatted text, links, and lists.</p>
        </div>

        <div>
          <button
            type="button"
            onClick={saveProfileDetails}
            disabled={profileSaving || !canSaveProfile}
            className="inline-flex items-center justify-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {profileSaving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </section>

      ) : null}

      {showDetails ? (
      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Visibility</h3>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span
            className={
              org.status === 'ACTIVE'
                ? 'inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700'
                : 'inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700'
            }
          >
            {org.status === 'ACTIVE' ? 'Public' : 'Private'}
          </span>
          <p className="text-xs text-slate-600">Public organizations are discoverable. Private organizations are only visible to admins.</p>
          {org.status === 'DRAFT' ? (
            <p className="text-xs text-slate-500">
              Drafts need a real organization name and custom URL slug before they can be made public.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (org.status === 'ACTIVE') {
                setPrivateVisibilityModalOpen(true)
                return
              }
              void updateVisibility(true)
            }}
            disabled={visibilitySaving || !canManage}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {visibilitySaving ? 'Saving…' : `Visibility: ${org.status === 'ACTIVE' ? 'Public' : 'Private'}`}
          </button>
        </div>
      </section>

      ) : null}

      {showPeople ? (
      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Members</h3>
        {membersLoading ? <p className="text-xs text-slate-500">Loading members…</p> : null}
        {!membersLoading && !members.length ? <p className="text-xs text-slate-500">No members yet.</p> : null}
        {members.length ? (
          <ul className="space-y-2">
            {members.map((entry) => {
              const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
              const canRemove = isOwner && entry.role !== 'OWNER'
              return (
                <li key={`${entry.userId}-${entry.role}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <VerifiedAvatar src={entry.user.avatarUrl} alt={displayName} initials={displayName} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{displayName}</p>
                      <p className="truncate text-xs text-slate-500">@{entry.user.handle} · {entry.role}</p>
                    </div>
                  </div>
                  {canRemove ? (
                    <button
                      type="button"
                      onClick={() => removeMember(entry.userId)}
                      disabled={memberActionUserId === entry.userId}
                      className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    >
                      {memberActionUserId === entry.userId ? 'Removing…' : 'Remove'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      ) : null}

      {showPeople ? (
      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Joined Members</h3>
        <p className="text-xs text-slate-500">Promote a joined member to manager so they can help run this organization.</p>
        {!followers.length ? <p className="text-xs text-slate-500">No joined members available to promote.</p> : null}
        {followers.length ? (
          <ul className="space-y-2">
            {followers.map((entry) => {
              const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
              return (
                <li key={entry.userId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <VerifiedAvatar src={entry.user.avatarUrl} alt={displayName} initials={displayName} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{displayName}</p>
                      <p className="truncate text-xs text-slate-500">@{entry.user.handle}</p>
                    </div>
                  </div>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => promoteFollower(entry.userId)}
                      disabled={memberActionUserId === entry.userId}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {memberActionUserId === entry.userId ? 'Promoting…' : 'Promote'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      ) : null}

      {showGovernance ? (
      <section className="surface-card space-y-4 p-6 shadow-subtle">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Governance testing actions</h3>
            <p className="text-xs text-slate-500">Trigger referral, reputation, RSVP, and economics actions directly.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshGovernanceData()}
            disabled={governanceLoading || Boolean(governanceActionBusy)}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Refresh governance
          </button>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Referral</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={referrerUserId}
              onChange={(event) => setReferrerUserId(event.target.value)}
              placeholder="Referrer userId"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={referredUserId}
              onChange={(event) => setReferredUserId(event.target.value)}
              placeholder="Referred userId"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={referralPlanId}
              onChange={(event) => setReferralPlanId(event.target.value)}
              placeholder="Plan id (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitReferral()}
              disabled={governanceActionBusy === 'referral'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'referral' ? 'Submitting…' : 'Record referral'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Reputation adjustment</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <input
              value={reputationUserId}
              onChange={(event) => setReputationUserId(event.target.value)}
              placeholder="User id"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={reputationDelta}
              onChange={(event) => setReputationDelta(event.target.value)}
              placeholder="Delta (int)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={reputationSource}
              onChange={(event) => setReputationSource(event.target.value)}
              placeholder="Source"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={reputationNote}
              onChange={(event) => setReputationNote(event.target.value)}
              placeholder="Note (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitReputation()}
              disabled={governanceActionBusy === 'reputation'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'reputation' ? 'Submitting…' : 'Adjust reputation'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Event RSVP</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={rsvpEventId}
              onChange={(event) => setRsvpEventId(event.target.value)}
              placeholder="Event id"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <select
              value={rsvpStatus}
              onChange={(event) => setRsvpStatus(event.target.value as 'GOING' | 'INTERESTED' | 'DECLINED')}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="GOING">GOING</option>
              <option value="INTERESTED">INTERESTED</option>
              <option value="DECLINED">DECLINED</option>
            </select>
            <select
              value={rsvpTicketType}
              onChange={(event) => setRsvpTicketType(event.target.value as 'FREE' | 'PAID')}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="FREE">FREE</option>
              <option value="PAID">PAID</option>
            </select>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitRsvp()}
              disabled={governanceActionBusy === 'rsvp'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'rsvp' ? 'Submitting…' : 'Submit RSVP'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Economics record</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              value={economicsKind}
              onChange={(event) => setEconomicsKind(event.target.value as 'membership' | 'event' | 'refund' | 'manual')}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="manual">manual</option>
              <option value="membership">membership</option>
              <option value="event">event</option>
              <option value="refund">refund</option>
            </select>
            <input
              value={economicsAmountCents}
              onChange={(event) => setEconomicsAmountCents(event.target.value)}
              placeholder="Amount cents"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={economicsCurrency}
              onChange={(event) => setEconomicsCurrency(event.target.value)}
              placeholder="Currency"
              maxLength={3}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={economicsMemberUserId}
              onChange={(event) => setEconomicsMemberUserId(event.target.value)}
              placeholder="Member userId (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={economicsEventId}
              onChange={(event) => setEconomicsEventId(event.target.value)}
              placeholder="Event id (required for kind=event)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={economicsNote}
              onChange={(event) => setEconomicsNote(event.target.value)}
              placeholder="Note (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitEconomicsRecord()}
              disabled={governanceActionBusy === 'economics'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'economics' ? 'Submitting…' : 'Record economics'}
            </button>
          </div>
        </div>
      </section>

      ) : null}

      {showRoles ? (
      <section className="surface-card space-y-4 p-6 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Role admin tools</h3>
          <p className="text-xs text-slate-500">Create ranks (roles) and assign permissions.</p>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Existing roles</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={selectedExistingRank ? String(selectedExistingRank.id) : ''}
              onChange={(event) => setExistingRankId(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              {existingRanks.map((rank) => (
                <option key={String(rank.id)} value={String(rank.id)}>
                  {String(rank.name)}{rank.system ? ' (system)' : ''}
                </option>
              ))}
            </select>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">Rank id:</span> {selectedExistingRank ? String(selectedExistingRank.id) : '—'}
            </div>
          </div>
          {selectedExistingRank ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Permissions</p>
                {selectedExistingRank.system ? (
                  <p className="text-[11px] font-semibold text-slate-500">Admins cannot be removed.</p>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {Array.isArray(selectedExistingRank.permissions) && selectedExistingRank.permissions.length ? (
                  selectedExistingRank.permissions.map((perm) => (
                    <span key={String(perm)} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {String(perm)}
                    </span>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">No permissions assigned.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Create rank</p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setRankName('Manager')
                setRankDescription('General-purpose manager role.')
                setRankVisibility('PUBLIC')
                setRankPermissions([
                  'approve_members',
                  'remove_members',
                  'promote_members',
                  'demote_members',
                  'view_audit_logs',
                  'manage_events',
                  'manage_sponsors',
                  'manage_referrals',
                  'award_achievements',
                  'create_announcements',
                  'pin_posts',
                  'moderate_content',
                ])
              }}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Template: Manager
            </button>
            <button
              type="button"
              onClick={() => {
                setRankName('Events Manager')
                setRankDescription('Manage events and announcements.')
                setRankVisibility('PUBLIC')
                setRankPermissions(['manage_events', 'create_paid_events', 'create_announcements', 'pin_posts'])
              }}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Template: Events Manager
            </button>
            <button
              type="button"
              onClick={() => {
                setRankName('Membership Manager')
                setRankDescription('Manage memberships and member actions.')
                setRankVisibility('PUBLIC')
                setRankPermissions([
                  'approve_members',
                  'remove_members',
                  'promote_members',
                  'demote_members',
                  'manage_membership_plans',
                  'view_revenue',
                  'issue_refunds',
                  'view_audit_logs',
                ])
              }}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Template: Membership Manager
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={rankName}
              onChange={(event) => setRankName(event.target.value)}
              placeholder="Rank name"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <select
              value={rankVisibility}
              onChange={(event) => setRankVisibility(event.target.value as OrgRankVisibility)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="PUBLIC">PUBLIC</option>
              <option value="PRIVATE">PRIVATE</option>
            </select>
          </div>
          <div className="grid gap-2">
            <input
              value={rankDescription}
              onChange={(event) => setRankDescription(event.target.value)}
              placeholder="Description (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Permissions</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRankPermissions([...ORG_PERMISSION_OPTIONS])}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setRankPermissions([])}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Unselect all
                  </button>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ORG_PERMISSION_OPTIONS.map((perm) => (
                  <label key={perm} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={rankPermissions.includes(perm)}
                      onChange={(event) => setRankPermissions((prev) => toggleListValue(prev, perm, event.target.checked))}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span className="grid gap-0.5">
                      <span className={perm === 'manage_events' ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-800'}>
                        {ORG_PERMISSION_HELP[perm].label}
                      </span>
                      <span className="text-[11px] text-slate-500">{ORG_PERMISSION_HELP[perm].description}</span>
                      <span className="text-[11px] text-slate-500">{perm}</span>
                    </span>
                  </label>
                ))}
              </div>
              {!rankPermissions.length ? <p className="mt-2 text-[11px] text-rose-700">Select at least one permission.</p> : null}
            </div>
            <input
              value={rankPromotionAuthority}
              onChange={(event) => setRankPromotionAuthority(event.target.value)}
              placeholder="Promotion authority (comma-separated rankIds, optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <div>
              <button
                type="button"
                onClick={() => void submitRank()}
                disabled={governanceActionBusy === 'rank'}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {governanceActionBusy === 'rank' ? 'Creating…' : 'Create rank'}
              </button>
            </div>
          </div>
        </div>
      </section>

      ) : null}

      {showGovernance ? (
      <section className="surface-card space-y-4 p-6 shadow-subtle">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Governance admin tools</h3>
          <p className="text-xs text-slate-500">Create plans, sponsors, achievements, and manage join mode/pending members.</p>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Join mode</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              value={joinMode}
              onChange={(event) => setJoinMode(event.target.value as OrgJoinMode)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              {ORG_JOIN_MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
            <input
              value={joinModeReason}
              onChange={(event) => setJoinModeReason(event.target.value)}
              placeholder="Reason (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void submitJoinMode()}
              disabled={governanceActionBusy === 'join-mode'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'join-mode' ? 'Saving…' : 'Update join mode'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">Current join mode: <span className="font-semibold text-slate-700">{governanceState?.joinMode ?? 'PUBLIC'}</span></p>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Create membership plan</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              placeholder="Plan name"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <select
              value={planType}
              onChange={(event) => setPlanType(event.target.value as OrgPlanType)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="FREE">FREE</option>
              <option value="ONE_TIME">ONE_TIME</option>
              <option value="SUBSCRIPTION">SUBSCRIPTION</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={planAmountCents}
              onChange={(event) => setPlanAmountCents(event.target.value)}
              placeholder="Amount cents"
              disabled={planType === 'FREE'}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            />
            <input
              value={planCurrency}
              onChange={(event) => setPlanCurrency(event.target.value)}
              placeholder="Currency"
              maxLength={3}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <select
              value={planInterval}
              onChange={(event) => setPlanInterval(event.target.value as OrgPlanInterval)}
              disabled={planType !== 'SUBSCRIPTION'}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            >
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={planDescription}
              onChange={(event) => setPlanDescription(event.target.value)}
              placeholder="Description (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={planRankId}
              onChange={(event) => setPlanRankId(event.target.value)}
              placeholder="Rank id (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={planGovernanceRights}
              onChange={(event) => setPlanGovernanceRights(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Grants governance rights
          </label>
          <div>
            <button
              type="button"
              onClick={() => void submitPlan()}
              disabled={governanceActionBusy === 'plan'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'plan' ? 'Creating…' : 'Create plan'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Add sponsor</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={sponsorName}
              onChange={(event) => setSponsorName(event.target.value)}
              placeholder="Sponsor name"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={sponsorTier}
              onChange={(event) => setSponsorTier(event.target.value)}
              placeholder="Tier"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={sponsorLogoUrl}
              onChange={(event) => setSponsorLogoUrl(event.target.value)}
              placeholder="Logo URL (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={sponsorRelationshipDescription}
              onChange={(event) => setSponsorRelationshipDescription(event.target.value)}
              placeholder="Relationship description (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={sponsorCivilHandle}
              onChange={(event) => setSponsorCivilHandle(event.target.value)}
              placeholder="Civil handle (optional, ex: @janedoe)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={sponsorLinkUrl}
              onChange={(event) => setSponsorLinkUrl(event.target.value)}
              placeholder="Link URL (optional: https://… or /com/… )"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={sponsorLinkLabel}
              onChange={(event) => setSponsorLinkLabel(event.target.value)}
              placeholder="Link label (optional, ex: Visit website)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <div className="text-[11px] text-slate-500">
              Tip: if you set a handle, we’ll link to their Civil profile.
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitSponsor()}
              disabled={governanceActionBusy === 'sponsor'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'sponsor' ? 'Saving…' : 'Add sponsor'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Create achievement</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={achievementTitle}
              onChange={(event) => setAchievementTitle(event.target.value)}
              placeholder="Title"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={achievementReputationPoints}
              onChange={(event) => setAchievementReputationPoints(event.target.value)}
              placeholder="Reputation points"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <select
              value={achievementVisibility}
              onChange={(event) => setAchievementVisibility(event.target.value as OrgRankVisibility)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="PUBLIC">PUBLIC</option>
              <option value="PRIVATE">PRIVATE</option>
            </select>
          </div>
          <input
            value={achievementDescription}
            onChange={(event) => setAchievementDescription(event.target.value)}
            placeholder="Description (optional)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
          />
          <div>
            <button
              type="button"
              onClick={() => void submitAchievement()}
              disabled={governanceActionBusy === 'achievement'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'achievement' ? 'Creating…' : 'Create achievement'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Award achievement</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={awardAchievementId}
              onChange={(event) => setAwardAchievementId(event.target.value)}
              placeholder="Achievement id"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={awardUserId}
              onChange={(event) => setAwardUserId(event.target.value)}
              placeholder="User id"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={awardNote}
              onChange={(event) => setAwardNote(event.target.value)}
              placeholder="Note (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitAchievementAward()}
              disabled={governanceActionBusy === 'award'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'award' ? 'Submitting…' : 'Award'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Member status / approval</p>
          <div className="grid gap-2 sm:grid-cols-5">
            <input
              value={memberStatusUserId}
              onChange={(event) => setMemberStatusUserId(event.target.value)}
              placeholder="User id"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <select
              value={memberStatusStatus}
              onChange={(event) => setMemberStatusStatus(event.target.value as OrgMembershipStatus)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            >
              {ORG_MEMBERSHIP_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <input
              value={memberStatusRankId}
              onChange={(event) => setMemberStatusRankId(event.target.value)}
              placeholder="Rank id (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={memberStatusPlanId}
              onChange={(event) => setMemberStatusPlanId(event.target.value)}
              placeholder="Plan id (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
            <input
              value={memberStatusReason}
              onChange={(event) => setMemberStatusReason(event.target.value)}
              placeholder="Reason (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[var(--cc-primary)] focus:outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={() => void submitMemberStatus()}
              disabled={governanceActionBusy === 'member-status'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {governanceActionBusy === 'member-status' ? 'Saving…' : 'Update member'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">Tip: For APPLICATION_REQUIRED joins, set status to ACTIVE to approve.</p>
        </div>
      </section>

      ) : null}

      {showGovernance ? (
      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Governance audit log</h3>
        <p className="text-xs text-slate-500">Recent governance actions for transparency and accountability.</p>
        {auditLoading ? <p className="text-xs text-slate-500">Loading audit log…</p> : null}
        {!auditLoading && !auditItems.length ? <p className="text-xs text-slate-500">No governance actions logged yet.</p> : null}
        {auditItems.length ? (
          <ul className="space-y-2">
            {auditItems.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{entry.action.replace(/\./g, ' ')}</p>
                  <p className="text-[11px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">Actor: {entry.actorUserId}</p>
                {entry.reason ? <p className="mt-1 text-xs text-slate-500">Reason: {entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      ) : null}

      {showGovernance ? (
      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Governance system overview</h3>
        <p className="text-xs text-slate-500">Live counts for plans, referrals, events, achievements, reputation, and economics.</p>
        {governanceLoading ? <p className="text-xs text-slate-500">Loading governance overview…</p> : null}
        {!governanceLoading && !governanceState ? <p className="text-xs text-slate-500">Governance overview unavailable.</p> : null}
        {governanceState ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Join mode: <span className="font-semibold text-slate-800">{governanceState.joinMode ?? 'PUBLIC'}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Plans: <span className="font-semibold text-slate-800">{governanceState.plans?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Sponsors: <span className="font-semibold text-slate-800">{governanceState.sponsors?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Events: <span className="font-semibold text-slate-800">{governanceState.events?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">RSVPs: <span className="font-semibold text-slate-800">{governanceState.eventRsvps?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Achievements: <span className="font-semibold text-slate-800">{governanceState.achievements?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Awards: <span className="font-semibold text-slate-800">{governanceState.achievementAwards?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Referrals: <span className="font-semibold text-slate-800">{governanceState.referrals?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Ledger entries: <span className="font-semibold text-slate-800">{governanceState.reputationLedger?.length ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Economics records: <span className="font-semibold text-slate-800">{governanceState.economics?.length ?? 0}</span></div>
          </div>
        ) : null}
        {governanceAnalytics ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Active members: <span className="font-semibold text-slate-800">{governanceAnalytics.activeMembers ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Pending members: <span className="font-semibold text-slate-800">{governanceAnalytics.pendingMembers ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Total tracked members: <span className="font-semibold text-slate-800">{governanceAnalytics.totalMembersTracked ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Paid events: <span className="font-semibold text-slate-800">{governanceAnalytics.paidEvents ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Going RSVPs: <span className="font-semibold text-slate-800">{governanceAnalytics.goingRsvps ?? 0}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Total revenue (cents): <span className="font-semibold text-slate-800">{governanceAnalytics.totalRevenueCents ?? 0}</span></div>
          </div>
        ) : null}
      </section>

      ) : null}

      {showDetails && canManage ? (
        <section className="surface-card space-y-3 p-6 shadow-subtle">
          <h3 className="text-sm font-semibold text-rose-700">Danger zone</h3>
          <p className="text-xs text-slate-600">
            Mark this organization as deleted and hide it from public discovery. Organization posts will also be marked deleted.
          </p>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            Delete organization
          </button>
        </section>
      ) : null}
    </div>
  )
}
