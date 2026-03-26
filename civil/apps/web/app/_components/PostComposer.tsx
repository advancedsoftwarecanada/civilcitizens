'use client'

import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RichTextEditor from './RichTextEditor'
import clsx from 'clsx'
import {
  CAUSE_MAXIMUM_GOAL_CENTS,
  CAUSE_MINIMUM_GOAL_CENTS,
  tokenizeTextEntities,
  type Jurisdiction,
  type PollResultsVisibility,
  type ReactionType,
} from '@civil/shared'
import { LuImagePlus, LuVideo } from 'react-icons/lu'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { extractHttpUrlsFromText } from '../_lib/civilLinks'
import { pushToast } from './useToasts'
import { formatDisplayName } from '../_lib/text'
import CivilComposerShell from './CivilComposerShell'
import LinkPreviewCard, { type LinkPreviewRecord } from './LinkPreviewCard'
import VerifiedAvatar from './VerifiedAvatar'

export type PostType = 'post' | 'article' | 'photo' | 'poll' | 'cause'
export type PostVisibility = 'public' | 'members'

const POST_TYPE_CHOICES: Array<{ type: PostType; label: string; icon: string }> = [
  { type: 'post', label: 'Post', icon: '📝' },
  { type: 'article', label: 'Article', icon: '📄' },
  { type: 'poll', label: 'Poll', icon: '📊' },
  { type: 'cause', label: 'Cause', icon: '🎯' },
]

export type ApiPost = {
  id: string
  seoSlug: string | null
  type: PostType
  title?: string | null
  body: string
  topicSlugs: string[]
  communitySlugs: string[]
  mentionedUserIds: string[]
  mentions: Array<{
    userId: string
    handle: string
    matchedHandle: string
    name?: string | null
  }>
  mediaUrl?: string | null
  images?: string[] | null
  linkPreview?: LinkPreviewRecord | null
  createdAt: string
  updatedAt: string
  jurisdiction: Jurisdiction
  provinceCode?: string | null
  provinceName?: string | null
  communitySlug?: string | null
  communityName?: string | null
  organization?: {
    id: string
    name: string
    slug: string
    isVerified: boolean
    logoUrl?: string | null
    coverUrl?: string | null
    provinceCode: string | null
    communitySlug: string | null
  } | null
  showBusinessAuthor?: boolean
  cause?: {
    draftId?: string | null
    goalAmountCents: number
    stageGoals: Array<{
      id: string
      amountCents: number
      description: string
      sortOrder: number
    }>
    raisedAmountCents: number
    remainingAmountCents: number
    contributionCount: number
    progressPercent: number
    status: 'active' | 'funded' | 'closed'
    createdAt: string | null
    updatedAt: string | null
    lastContributionAt: string | null
  } | null
  causeDraftId?: string | null
  poll?: {
    id: string
    resultsVisibility: PollResultsVisibility
    resultsAvailableAt: string | null
    firstVoteAt: string | null
    endedAt: string | null
    totalVotes: number | null
    maxOptions: number
    options: Array<{
      id: string
      label: string
      sortOrder: number
      voteCount: number | null
      percentage: number | null
    }>
    viewer: {
      hasVoted: boolean
      optionId: string | null
      canSeeResults: boolean
      canVote: boolean
    }
    authorCanAddOptions: boolean
    authorCanEndPoll: boolean
  } | null
  author: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  recentComments?: Array<{
    id: string
    postId: string
    parentId?: string | null
    body: string
    createdAt: string
    updatedAt: string
    score?: number
    optimistic?: boolean
    localPreview?: boolean
    author: {
      id: string
      handle: string
      name?: string | null
      avatarUrl?: string | null
      coverUrl?: string | null
      isPremium?: boolean
      isVerified?: boolean
    }
  }>
  counts?: {
    commentCount: number
    reactions?: number
    recentPositive?: number
    upvotes?: number
    downvotes?: number
    score?: number
  }
  votes?: {
    upvotes: number
    downvotes: number
    score: number
  }
  reactions?: {
    maple: number
    heart: number
    haha: number
    wow: number
    sad: number
    fire: number
    total: number
    positive: number
  }
  metrics?: {
    hotScore: number
  }
  viewer?: {
    reaction?: ReactionType | null
    vote?: number | null
  }
  sharedPost?: ApiPost | null
}

export type CommunityTarget = {
  provinceCode: string
  communitySlug: string
  communityName?: string | null
  provinceName?: string | null
  isHome?: boolean
}

type PostComposerProps = {
  me?: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
  } | null
  className?: string
  defaultPostType?: PostType
  communityTarget?: CommunityTarget | null
  communityOptions?: CommunityTarget[]
  organizationOptions?: Array<{ id: string; name: string }>
  businessTarget?: { businessId: string; businessName?: string | null } | null
  onPostCreated?: (post: ApiPost) => void
  variant?: 'card' | 'plain'
  defaultAudience?: 'friends' | 'family' | 'network' | 'community' | 'business'
  allowFamilyAudience?: boolean
  hideAudience?: boolean
}

const MAX_POST_LENGTH = 5000
const MIN_ARTICLE_TITLE_LENGTH = 3
const MIN_ARTICLE_BODY_LENGTH = 100
const MIN_CAUSE_BODY_LENGTH = 30
const MIN_POLL_OPTIONS = 2
const MAX_POLL_OPTIONS = 10
const PHOTO_MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')

const FRIENDS_VALUE = 'friends'
const FAMILY_VALUE = 'family'
const NETWORK_VALUE = 'network'
const BUSINESS_VALUE = 'business'
const COMMUNITY_PREFIX = 'community:'
const COMMUNITY_PROMPT_VALUE = `${COMMUNITY_PREFIX}__prompt`
const ORGANIZATION_PREFIX = 'organization:'
const POLL_RESULT_VISIBILITY_OPTIONS: Array<{ value: PollResultsVisibility; label: string; description: string }> = [
  { value: 'after_vote', label: 'After voting', description: 'Hide results until someone votes, then allow vote changes until the poll ends.' },
  { value: 'after_6_hours', label: 'After 6 hours', description: 'Keep results hidden for 6 hours, then notify voters when they unlock.' },
  { value: 'after_12_hours', label: 'After 12 hours', description: 'Keep results hidden for 12 hours, then notify voters when they unlock.' },
  { value: 'after_24_hours', label: 'After 24 hours', description: 'Keep results hidden for 24 hours, then notify voters when they unlock.' },
  { value: 'after_48_hours', label: 'After 48 hours', description: 'Keep results hidden for 48 hours, then notify voters when they unlock.' },
]

const buildCommunityKey = (target: CommunityTarget) => `${target.provinceCode}:${target.communitySlug}`
const buildCommunityValue = (target: CommunityTarget) => `${COMMUNITY_PREFIX}${buildCommunityKey(target)}`
const buildOrganizationValue = (id: string) => `${ORGANIZATION_PREFIX}${id}`

const formatCommunityLabel = (target: CommunityTarget) => {
  const name = target.communityName ?? target.communitySlug
  const location = target.provinceCode?.toUpperCase() ?? target.provinceName ?? ''
  const suffix = target.isHome ? ' (Home)' : ''
  const locationLabel = location ? ` - ${location}` : ''
  return `${name}${locationLabel}${suffix}`
}

const deriveInitialAudienceSelection = (
  currentTarget: CommunityTarget | null,
  defaultAudience: 'friends' | 'family' | 'network' | 'community' | 'business',
  options: CommunityTarget[],
  businessTarget: PostComposerProps['businessTarget'],
) => {
  if (businessTarget?.businessId) return BUSINESS_VALUE
  if (currentTarget) return buildCommunityValue(currentTarget)
  if (defaultAudience === 'community') {
    if (options.length === 1) {
      const firstOption = options[0]
      if (firstOption) {
        return buildCommunityValue(firstOption)
      }
    }
    return COMMUNITY_PROMPT_VALUE
  }
  if (defaultAudience === 'business') return BUSINESS_VALUE
  if (defaultAudience === 'family') return FAMILY_VALUE
  if (defaultAudience === 'network') return NETWORK_VALUE
  return FRIENDS_VALUE
}

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  self: 'Self',
  municipal: 'Municipal',
  provincial: 'Provincial',
  federal: 'Federal',
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function createInitialPollOptions() {
  return ['', '']
}

const pickPhotoVariantUrl = (variants?: Record<string, { url?: string | null } | null>) => {
  if (!variants) return null
  const preference = ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md', 'avatar@2x', 'avatar@1x']
  for (const key of preference) {
    const candidate = variants[key]?.url
    if (candidate) return candidate
  }
  const fallback = Object.values(variants).find((variant) => variant?.url)
  return fallback?.url ?? null
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_IMAGE_DIMENSION = 8000
const MAX_IMAGE_MEGA_PIXELS = 40
const DEFAULT_CAUSE_GOAL_DOLLARS = '2500'

function normalizeComposerPostType(postType: PostType): PostType {
  return postType === 'photo' ? 'post' : postType
}

function readCauseGoalAmountCents(value: string) {
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * 100)
}

const readImageDimensions = async (file: File): Promise<{ width: number; height: number } | null> => {
  try {
    const objectUrl = URL.createObjectURL(file)
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
        URL.revokeObjectURL(objectUrl)
      }
      img.onerror = () => {
        resolve(null)
        URL.revokeObjectURL(objectUrl)
      }
      img.src = objectUrl
    })
  } catch {
    return null
  }
}

type PhotoItem = {
  id: string
  file?: File
  previewUrl: string
  assetId?: string | null
  mediaUrl?: string | null
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  error?: string | null
}

type MentionSuggestion = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
  homeCommunity?: {
    provinceCode: string
    provinceName?: string | null
    communitySlug: string
    communityName?: string | null
  } | null
}

type ActiveMentionQuery = {
  start: number
  end: number
  query: string
}

type MentionMenuPosition = {
  left: number
  top: number
  width: number
}

function isMentionQueryCharacter(value: string | undefined) {
  return Boolean(value && /[A-Za-z0-9_]/.test(value))
}

function getActiveMentionQuery(value: string, cursor: number | null | undefined): ActiveMentionQuery | null {
  if (typeof cursor !== 'number' || cursor < 0) return null

  let markerIndex = cursor - 1
  while (markerIndex >= 0 && isMentionQueryCharacter(value[markerIndex])) {
    markerIndex -= 1
  }

  if (markerIndex < 0 || value[markerIndex] !== '@') return null
  if (markerIndex > 0 && isMentionQueryCharacter(value[markerIndex - 1])) return null

  const query = value.slice(markerIndex + 1, cursor)
  if (/[^A-Za-z0-9_]/.test(query)) return null

  return {
    start: markerIndex,
    end: cursor,
    query,
  }
}

const TEXTAREA_MIRROR_STYLE_PROPS = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-indent',
  'text-decoration',
  'text-align',
  'tab-size',
] as const

function measureTextareaCaret(
  textarea: HTMLTextAreaElement,
  cursor: number,
): { left: number; top: number; height: number } | null {
  if (typeof window === 'undefined') return null

  const computed = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  mirror.setAttribute('aria-hidden', 'true')
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflow = 'hidden'

  TEXTAREA_MIRROR_STYLE_PROPS.forEach((property) => {
    mirror.style.setProperty(property, computed.getPropertyValue(property))
  })

  mirror.style.width = `${textarea.clientWidth}px`
  mirror.textContent = textarea.value.slice(0, cursor)
  if (mirror.textContent.endsWith('\n')) {
    mirror.textContent += ' '
  }

  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(cursor) || '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5 || 24
  const left = marker.offsetLeft - textarea.scrollLeft
  const top = marker.offsetTop - textarea.scrollTop

  document.body.removeChild(mirror)
  return { left, top, height: lineHeight }
}

function measureMentionMenuPosition(
  textarea: HTMLTextAreaElement,
  wrapper: HTMLDivElement,
  cursor: number,
): MentionMenuPosition | null {
  const caret = measureTextareaCaret(textarea, cursor)
  if (!caret) return null

  const availableWidth = Math.max(220, wrapper.clientWidth - 16)
  const width = Math.min(360, availableWidth)
  const left = Math.min(Math.max(8, caret.left), Math.max(8, wrapper.clientWidth - width - 8))
  const top = Math.max(8, caret.top + caret.height + 8)

  return { left, top, width }
}

function formatMentionHomeCommunity(
  homeCommunity: MentionSuggestion['homeCommunity'],
) {
  if (!homeCommunity) return 'No home community yet'
  const provinceLabel = homeCommunity.provinceName ?? homeCommunity.provinceCode.toUpperCase()
  const communityLabel = homeCommunity.communityName ?? homeCommunity.communitySlug
  return `${provinceLabel} / ${communityLabel}`
}

function renderComposerHighlightedText(value: string) {
  const hashtagTokens = tokenizeTextEntities(value).filter((token) => token.kind === 'hashtag')
  if (!hashtagTokens.length) {
    if (!value.length) return '\u200b'
    return value.endsWith('\n') ? `${value}\u200b` : value
  }

  const fragments: JSX.Element[] = []
  let cursor = 0

  hashtagTokens.forEach((token, index) => {
    if (token.start > cursor) {
      fragments.push(<span key={`text-${index}-${cursor}`}>{value.slice(cursor, token.start)}</span>)
    }

    fragments.push(
      <span key={`hashtag-${token.start}-${token.end}`} className="text-[var(--cc-primary)]">
        {value.slice(token.start, token.end)}
      </span>,
    )

    cursor = token.end
  })

  if (cursor < value.length) {
    fragments.push(<span key={`text-tail-${cursor}`}>{value.slice(cursor)}</span>)
  }

  if (value.endsWith('\n')) {
    fragments.push(<span key="terminal-placeholder">{'\u200b'}</span>)
  }

  return fragments
}

export default function PostComposer({
  me = null,
  className,
  defaultPostType = 'post',
  communityTarget = null,
  communityOptions = [],
  organizationOptions = [],
  businessTarget = null,
  onPostCreated,
  variant = 'card',
  defaultAudience = 'friends',
  allowFamilyAudience = false,
  hideAudience = false,
}: PostComposerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [postType, setPostType] = useState<PostType>(() => normalizeComposerPostType(defaultPostType))
  const [draft, setDraft] = useState('')
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pollQuestionTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftMentionMenuAnchorRef = useRef<HTMLDivElement | null>(null)
  const pollMentionMenuAnchorRef = useRef<HTMLDivElement | null>(null)
  const [articleTitle, setArticleTitle] = useState('')
  const [articleBody, setArticleBody] = useState('<p></p>')
  const [pollOptions, setPollOptions] = useState<string[]>(() => createInitialPollOptions())
  const [pollResultsVisibility, setPollResultsVisibility] = useState<PollResultsVisibility>('after_vote')
  const [causeGoalInput, setCauseGoalInput] = useState(DEFAULT_CAUSE_GOAL_DOLLARS)
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composerLinkPreview, setComposerLinkPreview] = useState<{ sourceUrl: string; preview: LinkPreviewRecord | null } | null>(null)
  const [activeMentionQuery, setActiveMentionQuery] = useState<ActiveMentionQuery | null>(null)
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([])
  const [mentionSearching, setMentionSearching] = useState(false)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [mentionMenuPosition, setMentionMenuPosition] = useState<MentionMenuPosition | null>(null)
  const [draftScrollTop, setDraftScrollTop] = useState(0)
  const [pollQuestionScrollTop, setPollQuestionScrollTop] = useState(0)
  const [visibility, setVisibility] = useState<PostVisibility>('public')
  const [showBusinessAuthor, setShowBusinessAuthor] = useState(false)
  const normalizedCommunityOptions = useMemo(() => {
    return communityOptions.map((option) => ({
      ...option,
      communityName: option.communityName ?? option.communitySlug,
      provinceName: option.provinceName ?? option.provinceCode?.toUpperCase(),
    }))
  }, [communityOptions])
  const selectableCommunityOptions = useMemo(() => {
    if (!communityTarget) return normalizedCommunityOptions
    const targetKey = buildCommunityKey(communityTarget)
    if (normalizedCommunityOptions.some((option) => buildCommunityKey(option) === targetKey)) {
      return normalizedCommunityOptions
    }
    return [
      {
        ...communityTarget,
        communityName: communityTarget.communityName ?? communityTarget.communitySlug,
        provinceName: communityTarget.provinceName ?? communityTarget.provinceCode?.toUpperCase(),
      },
      ...normalizedCommunityOptions,
    ]
  }, [communityTarget, normalizedCommunityOptions])

  const [audienceSelection, setAudienceSelection] = useState(() =>
    deriveInitialAudienceSelection(communityTarget, defaultAudience, selectableCommunityOptions, businessTarget),
  )

  const articleBodyPlain = useMemo(() => stripHtml(articleBody), [articleBody])
  const causeGoalAmountCents = useMemo(() => readCauseGoalAmountCents(causeGoalInput), [causeGoalInput])
  const composerPreviewSource = useMemo(() => {
    if (postType === 'article') return articleBodyPlain
    return draft
  }, [articleBodyPlain, draft, postType])
  const firstComposerUrl = useMemo(() => extractHttpUrlsFromText(composerPreviewSource)[0] ?? null, [composerPreviewSource])
  const normalizedPollOptions = useMemo(
    () => pollOptions.map((option) => option.trim()).filter((option) => option.length > 0),
    [pollOptions],
  )
  const readyPhotoUrls = useMemo(
    () => photos.map((photo) => photo.mediaUrl).filter((value): value is string => Boolean(value)),
    [photos],
  )
  const hasPhotoUploadsInFlight = useMemo(
    () => photos.some((photo) => photo.status === 'uploading' || photo.status === 'processing'),
    [photos],
  )
  const hasPhotoUploadErrors = useMemo(() => photos.some((photo) => photo.status === 'error'), [photos])
  const photosReady = photos.length === 0 || readyPhotoUrls.length === photos.length

  const selectedOrganizationOption = useMemo(() => {
    if (businessTarget?.businessId) return null
    if (!audienceSelection.startsWith(ORGANIZATION_PREFIX)) return null
    const id = audienceSelection.slice(ORGANIZATION_PREFIX.length)
    return organizationOptions.find((org) => org.id === id) ?? null
  }, [audienceSelection, businessTarget, organizationOptions])

  const activeBusinessTarget = useMemo(() => {
    if (businessTarget?.businessId) return businessTarget
    if (selectedOrganizationOption) {
      return { businessId: selectedOrganizationOption.id, businessName: selectedOrganizationOption.name }
    }
    return null
  }, [businessTarget, selectedOrganizationOption])

  const audienceLocked = Boolean(businessTarget?.businessId)
  const isPromptSelected = audienceSelection === COMMUNITY_PROMPT_VALUE
  const audienceBlocked = !communityTarget && isPromptSelected
  const activeCommunity = useMemo(() => {
    if (activeBusinessTarget?.businessId) return null
    if (!audienceSelection.startsWith(COMMUNITY_PREFIX) || isPromptSelected) return null
    const key = audienceSelection.slice(COMMUNITY_PREFIX.length)
    return selectableCommunityOptions.find((option) => buildCommunityKey(option) === key) ?? null
  }, [activeBusinessTarget, audienceSelection, isPromptSelected, selectableCommunityOptions])

  useEffect(() => {
    if (businessTarget?.businessId) {
      setAudienceSelection(BUSINESS_VALUE)
      return
    }
    setAudienceSelection((prev) => {
      if (communityTarget) {
        const targetValue = buildCommunityValue(communityTarget)
        if (prev === COMMUNITY_PROMPT_VALUE || !prev.startsWith(COMMUNITY_PREFIX)) {
          return targetValue
        }
      }
      if (prev === COMMUNITY_PROMPT_VALUE && defaultAudience !== 'community') {
        if (defaultAudience === 'family') return FAMILY_VALUE
        return defaultAudience === 'network' ? NETWORK_VALUE : FRIENDS_VALUE
      }
      if (prev === COMMUNITY_PROMPT_VALUE && defaultAudience === 'community' && selectableCommunityOptions.length === 1) {
        const firstOption = selectableCommunityOptions[0]
        if (firstOption) {
          return buildCommunityValue(firstOption)
        }
      }
      if (prev.startsWith(COMMUNITY_PREFIX) && prev !== COMMUNITY_PROMPT_VALUE) {
        const key = prev.slice(COMMUNITY_PREFIX.length)
        const match = selectableCommunityOptions.some((option) => buildCommunityKey(option) === key)
        if (!match) {
          if (communityTarget) {
            return buildCommunityValue(communityTarget)
          }
          if (defaultAudience === 'community' && selectableCommunityOptions.length === 1) {
            const firstOption = selectableCommunityOptions[0]
            if (firstOption) {
              return buildCommunityValue(firstOption)
            }
          }
          if (defaultAudience === 'family') return FAMILY_VALUE
          return defaultAudience === 'network' ? NETWORK_VALUE : FRIENDS_VALUE
        }
      }
      if (prev === FAMILY_VALUE && !allowFamilyAudience) {
        return defaultAudience === 'network' ? NETWORK_VALUE : FRIENDS_VALUE
      }
      return prev
    })
  }, [allowFamilyAudience, businessTarget, communityTarget, defaultAudience, selectableCommunityOptions])

  const updateMentionMenuPosition = useCallback((cursor: number | null | undefined) => {
    if (typeof cursor !== 'number' || cursor < 0) {
      setMentionMenuPosition(null)
      return
    }

    const activeTextarea = postType === 'poll' ? pollQuestionTextareaRef.current : draftTextareaRef.current
    const activeAnchor = postType === 'poll' ? pollMentionMenuAnchorRef.current : draftMentionMenuAnchorRef.current
    if (!activeTextarea || !activeAnchor) {
      setMentionMenuPosition(null)
      return
    }

    setMentionMenuPosition(measureMentionMenuPosition(activeTextarea, activeAnchor, cursor))
  }, [postType])

  const updateMentionQueryFromCursor = useCallback((value: string, cursor: number | null | undefined) => {
    const nextQuery = getActiveMentionQuery(value, cursor)
    setActiveMentionQuery(nextQuery)
    setSelectedMentionIndex(0)
    if (nextQuery) {
      updateMentionMenuPosition(nextQuery.end)
    } else {
      setMentionMenuPosition(null)
    }
  }, [updateMentionMenuPosition])

  const applyMentionSuggestion = useCallback(
    (mention: MentionSuggestion) => {
      if (!activeMentionQuery) return

      const replacement = `@${mention.handle} `
      const nextDraft = `${draft.slice(0, activeMentionQuery.start)}${replacement}${draft.slice(activeMentionQuery.end)}`
      const nextCursor = activeMentionQuery.start + replacement.length
      const activeTextarea = postType === 'poll' ? pollQuestionTextareaRef.current : draftTextareaRef.current

      setDraft(nextDraft)
      setActiveMentionQuery(null)
      setMentionSuggestions([])
      setSelectedMentionIndex(0)
      setMentionMenuPosition(null)

      window.requestAnimationFrame(() => {
        activeTextarea?.focus()
        activeTextarea?.setSelectionRange(nextCursor, nextCursor)
      })
    },
    [activeMentionQuery, draft, postType],
  )

  useEffect(() => {
    if (postType !== 'post' && postType !== 'poll') {
      setActiveMentionQuery(null)
      setMentionSuggestions([])
      setMentionSearching(false)
      setSelectedMentionIndex(0)
      setMentionMenuPosition(null)
    }
  }, [postType])

  useEffect(() => {
    const query = activeMentionQuery?.query.trim() ?? ''
    if (!query.length) {
      setMentionSuggestions([])
      setMentionSearching(false)
      return
    }

    if (typeof window === 'undefined') return
    const token = localStorage.getItem('token')
    if (!token) {
      setMentionSuggestions([])
      setMentionSearching(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setMentionSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, limit: '8' })
        const response = await fetch(buildApiUrl(`/search/users?${params.toString()}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          if (!cancelled) setMentionSuggestions([])
          return
        }

        const payload = (await response.json().catch(() => null)) as { items?: MentionSuggestion[] } | null
        if (cancelled) return
        setMentionSuggestions(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        if (!cancelled && !controller.signal.aborted) setMentionSuggestions([])
      } finally {
        if (!cancelled) setMentionSearching(false)
      }
    }, 120)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [activeMentionQuery?.query])

  useEffect(() => {
    if (!activeMentionQuery) return

    const handleReposition = () => {
      updateMentionMenuPosition(activeMentionQuery.end)
    }

    window.addEventListener('resize', handleReposition)
    return () => {
      window.removeEventListener('resize', handleReposition)
    }
  }, [activeMentionQuery, updateMentionMenuPosition])

  const handleDraftSelectionEvent = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      updateMentionQueryFromCursor(event.currentTarget.value, event.currentTarget.selectionStart)
    },
    [updateMentionQueryFromCursor],
  )

  const handleDraftTextKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (!mentionSuggestions.length || !activeMentionQuery) {
        if (event.key === 'Escape' && activeMentionQuery) {
          setActiveMentionQuery(null)
          setMentionSuggestions([])
          setSelectedMentionIndex(0)
        }
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedMentionIndex((current) => (current + 1) % mentionSuggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const selectedMention = mentionSuggestions[selectedMentionIndex] ?? mentionSuggestions[0]
        if (selectedMention) {
          applyMentionSuggestion(selectedMention)
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setActiveMentionQuery(null)
        setMentionSuggestions([])
        setSelectedMentionIndex(0)
      }
    },
    [activeMentionQuery, applyMentionSuggestion, mentionSuggestions, selectedMentionIndex],
  )

  useEffect(() => {
    if (!firstComposerUrl) {
      setComposerLinkPreview(null)
      return
    }
    if (composerLinkPreview?.sourceUrl === firstComposerUrl) return

    let cancelled = false
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
          const headers = token ? { authorization: `Bearer ${token}` } : undefined
          const response = await fetch(buildApiUrl(`/link-preview?url=${encodeURIComponent(firstComposerUrl)}`), {
            headers,
            cache: 'no-store',
          })

          if (!response.ok) {
            if (!cancelled) {
              setComposerLinkPreview({ sourceUrl: firstComposerUrl, preview: null })
            }
            return
          }

          const payload = (await response.json().catch(() => null)) as { preview?: LinkPreviewRecord | null } | null
          if (!cancelled) {
            setComposerLinkPreview({ sourceUrl: firstComposerUrl, preview: payload?.preview ?? null })
          }
        } catch {
          if (!cancelled) {
            setComposerLinkPreview({ sourceUrl: firstComposerUrl, preview: null })
          }
        }
      })()
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [composerLinkPreview?.sourceUrl, firstComposerUrl])

  const startPhotoUpload = useCallback(async (id: string, file: File) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'uploading', error: null } : p)))
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'error', error: 'Sign in to upload a photo.' } : p)),
      )
      return
    }

    try {
      const initRes = await fetch(buildApiUrl('/media/uploads'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: 'post_image',
          mime: file.type || 'application/octet-stream',
          byteSize: file.size,
          filename: file.name,
        }),
      })

      if (!initRes.ok) {
        const payload = await initRes.json().catch(() => ({}))
        const reason = typeof payload?.error === 'string' ? payload.error : 'upload_init_failed'
        throw new Error(reason)
      }

      const initPayload = await initRes.json()
      const assetId: string = initPayload.assetId
      const upload: { url?: string; method?: string; headers?: Record<string, string> } = initPayload.upload || {}
      const proxyPath: string | null = typeof initPayload?.proxyPath === 'string' ? initPayload.proxyPath : null

      const tryDirect = async () => {
        if (!upload.url) return false

        // Avoid Mixed Content errors
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && upload.url.startsWith('http:')) {
          console.warn('Skipping direct upload due to protocol mismatch (Mixed Content)')
          return false
        }

        const res = await fetch(upload.url, {
          method: upload.method || 'PUT',
          headers: upload.headers,
          body: file,
        })
        return res.ok
      }

      const tryProxy = async () => {
        if (!proxyPath) return false
        const res = await fetch(buildApiUrl(proxyPath), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.type || 'application/octet-stream',
            'x-upload-byte-size': String(file.size),
          },
          body: file,
        })
        return res.ok
      }

      console.log('Starting upload for', id, 'direct:', !!upload.url, 'proxy:', !!proxyPath)
      const directOk = upload.url
        ? await tryDirect().catch((e) => {
            console.warn('Direct upload failed', e)
            return false
          })
        : false

      if (directOk) console.log('Direct upload succeeded')
      else console.log('Direct upload skipped or failed, trying proxy')

      const proxyOk = directOk
        ? true
        : await tryProxy().catch((e) => {
            console.warn('Proxy upload failed', e)
            return false
          })

      if (!directOk && !proxyOk) {
        throw new Error('upload_failed')
      }

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ assetId }),
      })

      if (!completeRes.ok) {
        throw new Error('processing_not_scheduled')
      }

      setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, assetId, status: 'processing' } : p)))

      let lastError: unknown = null
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const res = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
          headers: {
            authorization: `Bearer ${token}`,
          },
        }).catch((err) => {
          lastError = err
          return null
        })

        if (res && res.ok) {
          const payload = await res.json().catch(() => ({}))
          const asset = payload?.asset
          if (asset?.status === 'ready') {
            const variantUrl = pickPhotoVariantUrl(asset.variants)
            if (!variantUrl) {
              throw new Error('variant_missing')
            }
            setPhotos((prev) =>
              prev.map((p) => (p.id === id ? { ...p, mediaUrl: variantUrl, status: 'ready' } : p)),
            )
            return
          }
          if (asset?.status === 'failed') {
            throw new Error(asset.failureReason ?? 'processing_failed')
          }
        }
        await wait(2000)
      }

      throw lastError ?? new Error('processing_timeout')
    } catch (err) {
      console.error('Photo upload failed', err)
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' } : p,
        ),
      )
    }
  }, [])

  const canSubmit = useMemo(() => {
    if (postType === 'poll') {
      const questionLength = draft.trim().length
      const uniqueOptionCount = new Set(normalizedPollOptions.map((option) => option.toLowerCase())).size
      return (
        questionLength > 0 &&
        questionLength <= MAX_POST_LENGTH &&
        normalizedPollOptions.length >= MIN_POLL_OPTIONS &&
        normalizedPollOptions.length <= MAX_POLL_OPTIONS &&
        normalizedPollOptions.length === uniqueOptionCount &&
        photosReady &&
        !submitting
      )
    }
    if (postType === 'post') {
      const trimmed = draft.trim()
      return (trimmed.length > 0 || readyPhotoUrls.length > 0) && trimmed.length <= MAX_POST_LENGTH && photosReady && !submitting
    }
    if (postType === 'cause') {
      const trimmed = draft.trim()
      const titleOk = articleTitle.trim().length >= MIN_ARTICLE_TITLE_LENGTH
      const bodyOk = trimmed.length >= MIN_CAUSE_BODY_LENGTH && trimmed.length <= MAX_POST_LENGTH
      const goalOk = causeGoalAmountCents >= CAUSE_MINIMUM_GOAL_CENTS && causeGoalAmountCents <= CAUSE_MAXIMUM_GOAL_CENTS
      return titleOk && bodyOk && goalOk && photosReady && !submitting
    }

    const titleOk = articleTitle.trim().length >= MIN_ARTICLE_TITLE_LENGTH
    const bodyOk = articleBodyPlain.length >= MIN_ARTICLE_BODY_LENGTH
    return titleOk && bodyOk && photosReady && !submitting
  }, [articleBodyPlain, articleTitle, causeGoalAmountCents, draft, normalizedPollOptions, photosReady, postType, readyPhotoUrls.length, submitting])

  const resetComposer = useCallback(() => {
    setDraft('')
    setArticleTitle('')
    setArticleBody('<p></p>')
    setPollOptions(createInitialPollOptions())
    setPollResultsVisibility('after_vote')
    setCauseGoalInput(DEFAULT_CAUSE_GOAL_DOLLARS)
    setPostType(normalizeComposerPostType(defaultPostType))
    setAudienceSelection(deriveInitialAudienceSelection(communityTarget, defaultAudience, selectableCommunityOptions, businessTarget))
    setVisibility('public')
    setShowBusinessAuthor(false)
    setError(null)
    setComposerLinkPreview(null)
    setActiveMentionQuery(null)
    setMentionSuggestions([])
    setMentionSearching(false)
    setSelectedMentionIndex(0)
    setDraftScrollTop(0)
    setPollQuestionScrollTop(0)
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setPhotos([])
  }, [businessTarget, communityTarget, defaultAudience, defaultPostType, photos, selectableCommunityOptions])

  const submitPost = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!canSubmit || submitting) return

    if (!communityTarget && audienceSelection.startsWith(COMMUNITY_PREFIX) && !activeCommunity) {
      setError('Pick a community to publish to the community feed.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = (() => {
        if (postType === 'poll') {
          return {
            type: 'poll',
            body: draft.trim(),
            poll: {
              resultsVisibility: pollResultsVisibility,
              options: normalizedPollOptions,
            },
          }
        }
        if (postType === 'post') {
          return { type: 'post', body: draft }
        }
        if (postType === 'cause') {
          return {
            type: 'cause',
            title: articleTitle.trim(),
            body: draft,
            cause: {
              goalAmountCents: causeGoalAmountCents,
            },
          }
        }
        return { type: 'article', title: articleTitle.trim(), body: articleBody }
      })()

      if (readyPhotoUrls.length > 0) {
        payload.mediaUrl = readyPhotoUrls[0]
        payload.images = readyPhotoUrls
      }

      const targetCommunity = activeCommunity
      if (targetCommunity) {
        payload.communityProvince = targetCommunity.provinceCode
        payload.communitySlug = targetCommunity.communitySlug
      }
      payload.audience = activeBusinessTarget?.businessId
        ? 'organization'
        : targetCommunity
          ? 'community'
          : audienceSelection === FAMILY_VALUE
            ? 'family'
          : audienceSelection === NETWORK_VALUE
            ? 'network'
            : 'friends'
      payload.jurisdiction = targetCommunity ? 'municipal' : 'self'

      if (activeBusinessTarget?.businessId) {
        payload.businessId = activeBusinessTarget.businessId
        payload.visibility = visibility
        payload.showBusinessAuthor = showBusinessAuthor
      }

      const res = await fetch(buildApiUrl('/posts'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)

        const normalizeError = (value: unknown): string | null => {
          if (!value) return null
          if (typeof value === 'string') return value
          if (Array.isArray(value)) {
            const joined = value.map((item) => normalizeError(item)).filter(Boolean).join(' ')
            return joined.length ? joined : null
          }
          if (typeof value === 'object') {
            const parts = Object.values(value as Record<string, unknown>)
            const joined = parts.map((item) => normalizeError(item)).filter(Boolean).join(' ')
            return joined.length ? joined : null
          }
          return String(value)
        }

        const friendlyError = normalizeError((data as any)?.error) ?? normalizeError((data as any)?.message)
        setError(friendlyError ?? 'Unable to publish right now. Please try again.')
        return
      }

      const post = (await res.json()) as ApiPost
      onPostCreated?.(post)
      resetComposer()
    } finally {
      setSubmitting(false)
    }
  }, [activeBusinessTarget, activeCommunity, articleBody, articleTitle, audienceSelection, canSubmit, causeGoalAmountCents, communityTarget, draft, normalizedPollOptions, onPostCreated, pollResultsVisibility, postType, readyPhotoUrls, resetComposer, showBusinessAuthor, submitting, visibility])

  const composerAuthorName = useMemo(() => {
    if (!me) return 'You'
    return formatDisplayName(me.name) || me.handle || 'You'
  }, [me])

  const handlePhotoFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) return

      // Convert to array to persist files after clearing input
      const files = Array.from(fileList)

      // Clear input immediately so change event fires even if same file selected again
      event.target.value = ''

      const newPhotos: PhotoItem[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file) continue

        if (!ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
          console.warn('Invalid file type:', file.type)
          pushToast(`Skipped ${file.name}: Invalid file type.`, 'error')
          continue
        }

        if (file.size > PHOTO_MAX_BYTES) {
          console.warn('File too large:', file.size)
          pushToast(`Skipped ${file.name}: File too large (max 25MB).`, 'error')
          continue
        }

        try {
          const dims = await readImageDimensions(file)
          if (!dims) {
            console.warn('Could not read dimensions')
            pushToast(`Skipped ${file.name}: Could not read image.`, 'error')
            continue
          }
          const megaPixels = (dims.width * dims.height) / 1_000_000
          if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION || megaPixels > MAX_IMAGE_MEGA_PIXELS) {
            console.warn('Image too large dimensions')
            pushToast(`Skipped ${file.name}: Image resolution too high.`, 'error')
            continue
          }

          const id = Math.random().toString(36).slice(2)
          const previewUrl = URL.createObjectURL(file)
          newPhotos.push({ id, file, previewUrl, status: 'idle' })
        } catch (e) {
          console.error('Error processing image', e)
          pushToast(`Skipped ${file.name}: Error processing image.`, 'error')
        }
      }

      if (newPhotos.length === 0) {
        return
      }

      setPhotos((prev) => [...prev, ...newPhotos])
    },
    [],
  )

  useEffect(() => {
    photos.forEach((p) => {
      if (p.status === 'idle' && p.file) {
        startPhotoUpload(p.id, p.file)
      }
    })
  }, [photos, startPhotoUpload])

  // Keep track of photos for cleanup on unmount
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      if (!(event.ctrlKey || event.metaKey)) return
      if (!containerRef.current) return
      const target = event.target as Node | null
      if (!target || !containerRef.current.contains(target)) return
      if (!canSubmit || submitting) return
      event.preventDefault()
      void submitPost()
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [canSubmit, submitPost, submitting])

  const contentClasses = clsx('flex flex-col gap-4', className)

  const showCommunityWarning = !communityTarget && !normalizedCommunityOptions.length
  const mentionQueryValue = activeMentionQuery?.query.trim() ?? ''
  const showMentionEmptyState = mentionQueryValue.length > 0 && !mentionSearching && mentionSuggestions.length === 0
  const showMentionSuggestions =
    (postType === 'post' || postType === 'poll') &&
    Boolean(activeMentionQuery) &&
    Boolean(mentionQueryValue.length > 0) &&
    (mentionSearching || mentionSuggestions.length > 0 || showMentionEmptyState)

  const renderMentionSuggestionsMenu = () => {
    if (!showMentionSuggestions || !mentionMenuPosition) return null

    return (
      <div
        className="absolute z-30 max-h-[20rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/12"
        style={{
          left: `${mentionMenuPosition.left}px`,
          top: `${mentionMenuPosition.top}px`,
          width: `${mentionMenuPosition.width}px`,
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        {mentionSearching ? (
          <div className="flex items-center gap-3 px-4 py-3 text-sm text-slate-500">
            <span className="inline-flex h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-[var(--cc-primary)]" aria-hidden="true" />
            Searching people…
          </div>
        ) : mentionSuggestions.length > 0 ? (
          mentionSuggestions.map((mention, index) => {
            const displayName = formatDisplayName(mention.name) || mention.handle
            return (
              <button
                key={mention.id}
                type="button"
                className={clsx(
                  'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition',
                  index === selectedMentionIndex ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50',
                )}
                onMouseEnter={() => setSelectedMentionIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  applyMentionSuggestion(mention)
                }}
              >
                <VerifiedAvatar
                  src={mention.avatarUrl ?? null}
                  alt={displayName}
                  initials={displayName}
                  size={40}
                  isVerified={Boolean(mention.isVerified)}
                  isBusiness={Boolean(mention.isPremium)}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-slate-900">
                    <span className="truncate font-semibold">{displayName}</span>
                    <span className="truncate text-xs text-slate-500">@{mention.handle}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">{formatMentionHomeCommunity(mention.homeCommunity ?? null)}</span>
                </span>
              </button>
            )
          })
        ) : (
          <div className="px-4 py-3 text-sm text-slate-500">
            No people found for <span className="font-semibold text-slate-700">@{mentionQueryValue}</span>.
          </div>
        )}
      </div>
    )
  }

  const composerContent = (
    <>
      <header
        className={clsx(
          'flex flex-col gap-4',
          variant !== 'plain' && !hideAudience && 'lg:flex-row lg:items-start lg:justify-between',
        )}
      >
        {!hideAudience ? (
          <div className="flex flex-col gap-2">
            <select
              className={clsx(
                'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none',
                variant === 'plain' ? 'max-w-full' : 'max-w-sm',
              )}
              value={
                businessTarget?.businessId
                  ? BUSINESS_VALUE
                  : audienceLocked && activeCommunity
                    ? buildCommunityValue(activeCommunity)
                    : selectedOrganizationOption
                      ? buildOrganizationValue(selectedOrganizationOption.id)
                      : audienceSelection
              }
              onChange={(event) => setAudienceSelection(event.target.value)}
              disabled={audienceLocked}
            >
              {businessTarget?.businessId ? (
                <option value={BUSINESS_VALUE}>{businessTarget.businessName ?? 'Organization'}</option>
              ) : (
                <>
                  {allowFamilyAudience && defaultAudience !== 'community' ? (
                    <optgroup label="Family">
                      <option value={FAMILY_VALUE}>Family</option>
                    </optgroup>
                  ) : null}

                  {defaultAudience !== 'community' ? (
                    <optgroup label="Friends">
                      <option value={FRIENDS_VALUE}>Friends</option>
                    </optgroup>
                  ) : null}

                  {defaultAudience !== 'community' ? (
                    <optgroup label="Network">
                      <option value={NETWORK_VALUE}>Network</option>
                    </optgroup>
                  ) : null}

                  {selectableCommunityOptions.length || (!communityTarget && isPromptSelected) ? (
                    <optgroup label="Communities">
                      {!communityTarget && isPromptSelected ? (
                        <option value={COMMUNITY_PROMPT_VALUE} hidden disabled>
                          Select a community
                        </option>
                      ) : null}
                      {selectableCommunityOptions.map((option) => (
                        <option key={buildCommunityKey(option)} value={buildCommunityValue(option)}>
                          {formatCommunityLabel(option)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}

                  {organizationOptions.length ? (
                    <optgroup label="Organizations">
                      {organizationOptions.map((org) => (
                        <option key={org.id} value={buildOrganizationValue(org.id)}>
                          {org.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </>
              )}
            </select>
            {showCommunityWarning ? (
              <p className="text-xs text-slate-500">Follow a community to publish in its public feed.</p>
            ) : null}
            {!businessTarget?.businessId && isPromptSelected ? (
              <p className="text-xs text-amber-600">Pick a community to share this post publicly.</p>
            ) : null}
          </div>
        ) : null}

        {activeBusinessTarget?.businessId ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Visibility</span>
              <div
                className={clsx(
                  'flex w-full max-w-full items-center gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500',
                  variant === 'plain'
                    ? 'flex-wrap'
                    : 'overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
                )}
              >
                <button
                  type="button"
                  className={clsx(
                    'whitespace-nowrap rounded-full px-4 py-1 transition',
                    variant !== 'plain' && 'shrink-0',
                    visibility === 'public' ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                  )}
                  onClick={() => setVisibility('public')}
                  disabled={submitting}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={clsx(
                    'whitespace-nowrap rounded-full px-4 py-1 transition',
                    variant !== 'plain' && 'shrink-0',
                    visibility === 'members' ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                  )}
                  onClick={() => setVisibility('members')}
                  disabled={submitting}
                >
                  Members only
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Author box</span>
              <div
                className={clsx(
                  'flex w-full max-w-full items-center gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500',
                  variant === 'plain'
                    ? 'flex-wrap'
                    : 'overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
                )}
              >
                <button
                  type="button"
                  className={clsx(
                    'whitespace-nowrap rounded-full px-4 py-1 transition',
                    variant !== 'plain' && 'shrink-0',
                    !showBusinessAuthor ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                  )}
                  onClick={() => setShowBusinessAuthor(false)}
                  disabled={submitting}
                >
                  As Organization
                </button>
                <button
                  type="button"
                  className={clsx(
                    'whitespace-nowrap rounded-full px-4 py-1 transition',
                    variant !== 'plain' && 'shrink-0',
                    showBusinessAuthor ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                  )}
                  onClick={() => setShowBusinessAuthor(true)}
                  disabled={submitting}
                >
                  {`As Me (${composerAuthorName})`}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <div
            className={clsx(
              'flex w-full max-w-full items-center gap-1 rounded-full bg-slate-100 p-1 text-sm font-semibold text-slate-500',
              variant === 'plain'
                ? 'flex-wrap'
                : 'overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            {POST_TYPE_CHOICES.map((choice) => {
              const isActive = postType === choice.type
              return (
                <button
                  key={choice.type}
                  type="button"
                  className={clsx(
                    'inline-flex min-w-[108px] items-center justify-center gap-2.5 whitespace-nowrap rounded-full px-4 py-1.5 transition',
                    variant !== 'plain' && 'shrink-0',
                    isActive ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500 hover:text-slate-700',
                  )}
                  onClick={() => setPostType(choice.type)}
                  disabled={submitting}
                >
                  <span
                    className={clsx(
                      'inline-flex h-6 w-6 items-center justify-center rounded-full text-[0.95rem] leading-none',
                      isActive ? 'bg-[rgba(213,43,30,0.08)] text-[var(--cc-primary)]' : 'bg-slate-200/80 text-slate-600',
                    )}
                    role="img"
                    aria-label={choice.label}
                  >
                    {choice.icon}
                  </span>
                  {choice.label}
                </button>
              )
            })}
          </div>
        </div>
      </header>

      <div className="space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {postType === 'post' ? (
          <div className="space-y-2">
            <div ref={draftMentionMenuAnchorRef} className="relative">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-[var(--cc-primary)] focus-within:bg-white">
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                  <div
                    className="min-h-full whitespace-pre-wrap break-words px-4 py-3 text-base leading-6 text-slate-800"
                    style={{ transform: `translateY(-${draftScrollTop}px)` }}
                  >
                    {renderComposerHighlightedText(draft)}
                  </div>
                </div>
                <textarea
                  ref={draftTextareaRef}
                  className="relative z-10 block w-full resize-y border-0 bg-transparent px-4 py-3 text-base leading-6 text-transparent caret-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  style={{ caretColor: '#1e293b' }}
                  placeholder="Share something"
                  rows={4}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    updateMentionQueryFromCursor(event.target.value, event.target.selectionStart)
                  }}
                  onSelect={handleDraftSelectionEvent}
                  onClick={handleDraftSelectionEvent}
                  onKeyDown={handleDraftTextKeyDown}
                  onScroll={(event) => {
                    setDraftScrollTop(event.currentTarget.scrollTop)
                    updateMentionMenuPosition(event.currentTarget.selectionStart)
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (
                        document.activeElement !== draftTextareaRef.current &&
                        document.activeElement !== pollQuestionTextareaRef.current
                      ) {
                        setActiveMentionQuery(null)
                        setMentionSuggestions([])
                        setMentionSearching(false)
                        setMentionMenuPosition(null)
                      }
                    }, 0)
                  }}
                  maxLength={MAX_POST_LENGTH}
                  disabled={submitting}
                />
              </div>
              {renderMentionSuggestionsMenu()}
            </div>
            <div className="flex items-center justify-end text-xs text-slate-500">
              <span>
                {draft.trim().length}/{MAX_POST_LENGTH}
              </span>
            </div>
          </div>
        ) : postType === 'article' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold text-slate-600" htmlFor="article-title">
                Headline
              </label>
              <input
                id="article-title"
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 shadow-inner"
                placeholder="Give readers a headline"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                maxLength={160}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-600">Story</label>
              <RichTextEditor
                value={articleBody}
                onChange={setArticleBody}
                placeholder="Share something"
                minHeight={260}
                disabled={submitting}
              />
              <div className="mt-1 flex justify-end text-xs text-slate-500">
                <span>{articleBodyPlain.length}/10000</span>
              </div>
            </div>
          </div>
        ) : postType === 'cause' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-600" htmlFor="cause-title">
                Cause title
              </label>
              <input
                id="cause-title"
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 shadow-inner"
                placeholder="What are you trying to fund?"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                maxLength={160}
                disabled={submitting}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-600" htmlFor="cause-description">
                  Description
                </label>
                <div ref={draftMentionMenuAnchorRef} className="relative">
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-[var(--cc-primary)] focus-within:bg-white">
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                      <div
                        className="min-h-full whitespace-pre-wrap break-words px-4 py-3 text-base leading-6 text-slate-800"
                        style={{ transform: `translateY(-${draftScrollTop}px)` }}
                      >
                        {renderComposerHighlightedText(draft)}
                      </div>
                    </div>
                    <textarea
                      id="cause-description"
                      ref={draftTextareaRef}
                      className="relative z-10 block w-full resize-y border-0 bg-transparent px-4 py-3 text-base leading-6 text-transparent caret-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                      style={{ caretColor: '#1e293b' }}
                      placeholder="Explain the cause, who it helps, and what the funds will cover. Use @mentions and #hashtags if they help people find it."
                      rows={6}
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value)
                        updateMentionQueryFromCursor(event.target.value, event.target.selectionStart)
                      }}
                      onSelect={handleDraftSelectionEvent}
                      onClick={handleDraftSelectionEvent}
                      onKeyDown={handleDraftTextKeyDown}
                      onScroll={(event) => {
                        setDraftScrollTop(event.currentTarget.scrollTop)
                        updateMentionMenuPosition(event.currentTarget.selectionStart)
                      }}
                      maxLength={MAX_POST_LENGTH}
                      disabled={submitting}
                    />
                  </div>
                  {renderMentionSuggestionsMenu()}
                </div>
                <div className="flex items-center justify-end text-xs text-slate-500">
                  <span>
                    {draft.trim().length}/{MAX_POST_LENGTH}
                  </span>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="cause-goal">
                    Funding goal
                  </label>
                  <input
                    id="cause-goal"
                    type="number"
                    min={CAUSE_MINIMUM_GOAL_CENTS / 100}
                    max={CAUSE_MAXIMUM_GOAL_CENTS / 100}
                    step="50"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none"
                    value={causeGoalInput}
                    onChange={(event) => setCauseGoalInput(event.target.value)}
                    disabled={submitting}
                  />
                  <p className="mt-2 text-xs text-slate-500">Set a clear amount in CAD. The goal stays visible on the feed card and thread page.</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
                  <p className="font-semibold">Cause notes</p>
                  <p className="mt-1">Funding goes into your Civil Wallet. You&apos;ll need a connected Stripe payout account before publishing.</p>
                </div>
              </div>
            </div>
          </div>
        ) : postType === 'poll' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-600" htmlFor="poll-question">
                Question
              </label>
              <div ref={pollMentionMenuAnchorRef} className="relative">
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-[var(--cc-primary)] focus-within:bg-white">
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                    <div
                      className="min-h-full whitespace-pre-wrap break-words px-4 py-3 text-base leading-6 text-slate-800"
                      style={{ transform: `translateY(-${pollQuestionScrollTop}px)` }}
                    >
                      {renderComposerHighlightedText(draft)}
                    </div>
                  </div>
                  <textarea
                    id="poll-question"
                    ref={pollQuestionTextareaRef}
                    className="relative z-10 block w-full resize-y border-0 bg-transparent px-4 py-3 text-base leading-6 text-transparent caret-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                    style={{ caretColor: '#1e293b' }}
                    placeholder="Ask the community something specific"
                    rows={3}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      updateMentionQueryFromCursor(event.target.value, event.target.selectionStart)
                    }}
                    onSelect={handleDraftSelectionEvent}
                    onClick={handleDraftSelectionEvent}
                    onKeyDown={handleDraftTextKeyDown}
                    onScroll={(event) => {
                      setPollQuestionScrollTop(event.currentTarget.scrollTop)
                      updateMentionMenuPosition(event.currentTarget.selectionStart)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        if (
                          document.activeElement !== draftTextareaRef.current &&
                          document.activeElement !== pollQuestionTextareaRef.current
                        ) {
                          setActiveMentionQuery(null)
                          setMentionSuggestions([])
                          setMentionSearching(false)
                          setMentionMenuPosition(null)
                        }
                      }, 0)
                    }}
                    maxLength={MAX_POST_LENGTH}
                    disabled={submitting}
                  />
                </div>
                {renderMentionSuggestionsMenu()}
              </div>
              <div className="flex items-center justify-end text-xs text-slate-500">
                <span>
                  {draft.trim().length}/{MAX_POST_LENGTH}
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Options</p>
                  <p className="text-xs text-slate-500">Add between 2 and 10 answer choices. You can add more later, but existing ones lock once voting starts.</p>
                </div>
                <span className="text-xs font-semibold text-slate-500">
                  {normalizedPollOptions.length}/{MAX_POLL_OPTIONS}
                </span>
              </div>

              <div className="space-y-2">
                {pollOptions.map((option, index) => (
                  <div key={`poll-option-${index}`} className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-500">
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:outline-none"
                      placeholder={`Option ${index + 1}`}
                      value={option}
                      onChange={(event) =>
                        setPollOptions((prev) => prev.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                      }
                      maxLength={160}
                      disabled={submitting}
                    />
                    {pollOptions.length > MIN_POLL_OPTIONS ? (
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:text-slate-700"
                        onClick={() => setPollOptions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        disabled={submitting}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              {pollOptions.length < MAX_POLL_OPTIONS ? (
                <button
                  type="button"
                  className="rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-800"
                  onClick={() => setPollOptions((prev) => [...prev, ''])}
                  disabled={submitting}
                >
                  Add option
                </button>
              ) : null}
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
              <label className="block text-sm font-semibold text-slate-700" htmlFor="poll-results-visibility">
                Results visible
              </label>
              <select
                id="poll-results-visibility"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none"
                value={pollResultsVisibility}
                onChange={(event) => setPollResultsVisibility(event.target.value as PollResultsVisibility)}
                disabled={submitting}
              >
                {POLL_RESULT_VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                {POLL_RESULT_VISIBILITY_OPTIONS.find((option) => option.value === pollResultsVisibility)?.description}
              </p>
              <p className="text-xs text-slate-500">Votes can be changed until you end the poll.</p>
            </div>
          </div>
        ) : null}

        {composerLinkPreview?.preview ? <LinkPreviewCard preview={composerLinkPreview.preview} /> : null}

        {photos.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
              >
                <img
                  src={photo.mediaUrl ?? photo.previewUrl}
                  alt="Post upload"
                  className="h-full w-full object-cover"
                />
                {photo.status === 'uploading' || photo.status === 'processing' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white">
                    {photo.status === 'uploading' ? 'Uploading...' : 'Processing...'}
                  </div>
                ) : null}
                {photo.status === 'error' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-500/80 p-2 text-center text-xs font-semibold text-white">
                    {photo.error ?? 'Error'}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                  onClick={() => {
                    URL.revokeObjectURL(photo.previewUrl)
                    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          multiple
          onChange={handlePhotoFile}
        />

        {hasPhotoUploadErrors ? <p className="text-xs text-red-600">Some photos failed to upload.</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              <LuImagePlus className="h-4 w-4" />
              {photos.length > 0 ? 'Add Photos' : 'Add Photos'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-400"
              disabled
              aria-disabled="true"
            >
              <LuVideo className="h-4 w-4" />
              Video
            </button>
            {hasPhotoUploadsInFlight ? <span className="text-xs text-slate-500">Finishing uploads…</span> : null}
          </div>

          <button
            className="rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={submitPost}
            disabled={!canSubmit || submitting || audienceBlocked}
          >
            {submitting ? 'Publishing…' : postType === 'article' ? 'Publish article' : postType === 'cause' ? 'Start cause' : 'Post'}
          </button>
        </div>
      </div>
    </>
  )

  if (variant === 'card') {
    return (
      <CivilComposerShell ref={containerRef} className={clsx('shadow-panel', className)} bodyClassName="flex flex-col gap-4">
        {composerContent}
      </CivilComposerShell>
    )
  }

  return (
    <section ref={containerRef} className={contentClasses}>
      {composerContent}
    </section>
  )
}
