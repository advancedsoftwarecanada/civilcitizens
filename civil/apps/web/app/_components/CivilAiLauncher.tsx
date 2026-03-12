'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, ReactNode, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import clsx from 'clsx'
import { HiOutlineArrowPath, HiOutlineArrowUp, HiOutlineXMark } from 'react-icons/hi2'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'
import { hasDeclaredCivilStatus, hasHomeCommunity } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'

type AiMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
  references?: CivilAiReference[]
}

type CivilAiReference = {
  kind: 'community' | 'event' | 'job' | 'market' | 'organization' | 'post'
  id: string
  title: string
  subtitle: string | null
  summary: string | null
  href: string
  imageUrl: string | null
  badge: string | null
}

type AiHistoryResponse = {
  items: Array<{
    role: 'assistant' | 'user'
    content: string
    createdAt: string
    references?: CivilAiReference[]
  }>
}

type AiChatResponse = {
  conversationId?: string
  message?: {
    role?: string
    content?: string
    references?: CivilAiReference[]
  } | null
}

type AiChatJobCreateResponse = {
  jobId?: string
  conversationId?: string
  status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
}

type AiChatJobPollResponse = AiChatResponse & {
  jobId?: string
  status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  error?: string | null
}

const STARTER_MESSAGE = {
  id: 'civil-ai-intro',
  role: 'assistant' as const,
  content:
    'I am Civil AI. Ask about a community issue, a civic process, or what to do next inside Civil Citizens.',
}

const CIVIL_AI_OPEN_STORAGE_KEY = 'civil-ai-open'
const CIVIL_AI_CONVERSATION_STORAGE_KEY = 'civil-ai-conversation-id'
const CIVIL_AI_MAX_VISIBLE_MESSAGES = 8
const CIVIL_AI_POLL_TIMEOUT_MS = 15 * 60 * 1000
const CIVIL_AI_HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])

function nextMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function pruneCivilAiMessages(messages: AiMessage[]) {
  const trimmed = messages.filter((message) => message.id !== STARTER_MESSAGE.id).slice(-CIVIL_AI_MAX_VISIBLE_MESSAGES)
  return trimmed.length ? trimmed : [STARTER_MESSAGE]
}

function isCivilInternalHref(href: string) {
  if (!href) return false
  if (href.startsWith('/')) return true
  try {
    const parsed = new URL(href)
    const host = parsed.hostname.toLowerCase()
    return host === 'civilcitizens.ca' || host.endsWith('.civilcitizens.ca')
  } catch {
    return false
  }
}

function toCivilAppHref(href: string) {
  if (href.startsWith('/')) return href
  try {
    const parsed = new URL(href)
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/'
  } catch {
    return href
  }
}

function createCivilAiConversationId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return nextMessageId('conversation')
}

function buildCivilAiLoadingSteps(question: string) {
  const normalized = question.trim().toLowerCase()
  const wantsEvents = /(event|events|meetup|meetups|metup|metups|networking|networking event|networking events|happening|going on|tonight|today|this weekend|this month|attend)/.test(normalized)
  const wantsJobs = /(job|jobs|hiring|employment|position|positions|work)/.test(normalized)
  const wantsMarket = /(buy|buying|looking for|looking to buy|where can i buy|shopping|shop for|for sale|marketplace|listing|listings|purchase)/.test(normalized)
  const wantsPosts = /(post|posts|people saying|talking about|discussion|discussions|conversation|conversations|debate|debates)/.test(normalized)
  const wantsOrganizations = /(organization|organizations|group|groups|association|associations)/.test(normalized)
  const wantsProfile = /(my name|who am i|do you know my name|my profile|my experience|my organizations|i belong to)/.test(normalized)
  const wantsToday = /(today|tonight|this afternoon|this evening)/.test(normalized)
  const wantsThisMonth = /(this month|this week)/.test(normalized)

  if (wantsProfile) {
    return [
      'Checking your signed-in Civil profile.',
      'Reviewing your experience and organization context.',
      'Pulling together the most relevant profile details.',
    ]
  }

  if (wantsEvents) {
    return [
      'Checking your home and nearby communities.',
      wantsToday ? 'Looking up events happening today.' : wantsThisMonth ? 'Looking up events happening this month.' : 'Looking up nearby events.',
      'Considering a few nearby communities as well.',
      "If local event results are thin, I'll expand the search nearby.",
    ]
  }

  if (wantsJobs) {
    return [
      'Checking your local communities and organizations.',
      'Looking up active jobs nearby.',
      'Considering organization and location matches together.',
    ]
  }

  if (wantsMarket) {
    return [
      'Checking Civil marketplace listings first.',
      'Matching the product terms against active listings.',
      'Keeping the answer anchored to listings that exist right now.',
    ]
  }

  if (wantsPosts || wantsOrganizations) {
    return [
      'Checking your local communities first.',
      wantsPosts ? 'Looking up what people are saying nearby.' : 'Looking up local organizations tied to your question.',
      wantsOrganizations ? 'Considering which organizations are most relevant.' : 'Considering a few related local signals.',
      'If the first pass is thin, I will broaden the local search.',
    ]
  }

  return [
    'Checking your signed-in Civil context.',
    'Considering a few relevant local angles.',
    'Looking up the best matching Civil data.',
  ]
}

function waitForCivilAiPollDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function splitCivilAiUrlSuffix(value: string) {
  let href = value
  let suffix = ''

  while (/[.,!?;:]$/.test(href)) {
    suffix = href.slice(-1) + suffix
    href = href.slice(0, -1)
  }

  while (href.endsWith(')')) {
    const openCount = (href.match(/\(/g) ?? []).length
    const closeCount = (href.match(/\)/g) ?? []).length
    if (closeCount <= openCount) break
    suffix = `)${suffix}`
    href = href.slice(0, -1)
  }

  return { href, suffix }
}

function renderInlineCivilAiMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<]+))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      nodes.push(<strong key={`strong-${match.index}`} className="font-semibold">{match[2]}</strong>)
    } else if (match[3]) {
      nodes.push(
        <code key={`code-${match.index}`} className="rounded bg-slate-900/8 px-1.5 py-0.5 text-[0.92em]">
          {match[3]}
        </code>,
      )
    } else if (match[4] && match[5]) {
      const href = match[5]
      nodes.push(
        isCivilInternalHref(href) ? (
          <Link
            key={`link-${match.index}`}
            href={toCivilAppHref(href)}
            className="font-semibold text-[var(--cc-primary)] underline underline-offset-2"
          >
            {match[4]}
          </Link>
        ) : (
          <a
            key={`link-${match.index}`}
            href={href}
            className="font-semibold text-[var(--cc-primary)] underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            {match[4]}
          </a>
        ),
      )
    } else if (match[6]) {
      const { href, suffix } = splitCivilAiUrlSuffix(match[6])
      if (href) {
        nodes.push(
          isCivilInternalHref(href) ? (
            <Link
              key={`plain-link-${match.index}`}
              href={toCivilAppHref(href)}
              className="font-semibold text-[var(--cc-primary)] underline underline-offset-2 break-all"
            >
              {href}
            </Link>
          ) : (
            <a
              key={`plain-link-${match.index}`}
              href={href}
              className="font-semibold text-[var(--cc-primary)] underline underline-offset-2 break-all"
              target="_blank"
              rel="noreferrer"
            >
              {href}
            </a>
          ),
        )
      }
      if (suffix) {
        nodes.push(suffix)
      }
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function renderCivilAiBlock(block: string, index: number) {
  const trimmed = block.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('### ')) {
    return <h3 key={`h3-${index}`} className="mb-2 text-sm font-semibold leading-tight last:mb-0">{renderInlineCivilAiMarkdown(trimmed.slice(4))}</h3>
  }
  if (trimmed.startsWith('## ')) {
    return <h2 key={`h2-${index}`} className="mb-2 text-[15px] font-semibold leading-tight last:mb-0">{renderInlineCivilAiMarkdown(trimmed.slice(3))}</h2>
  }
  if (trimmed.startsWith('# ')) {
    return <h1 key={`h1-${index}`} className="mb-2 text-base font-semibold leading-tight last:mb-0">{renderInlineCivilAiMarkdown(trimmed.slice(2))}</h1>
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line))
  if (lines.length > 0 && bulletLines.length === lines.length) {
    return (
      <ul key={`ul-${index}`} className="mb-3 list-disc space-y-1 pl-5 last:mb-0">
        {lines.map((line, lineIndex) => (
          <li key={`li-${index}-${lineIndex}`} className="pl-1">
            {renderInlineCivilAiMarkdown(line.replace(/^[-*]\s+/, ''))}
          </li>
        ))}
      </ul>
    )
  }

  const numberedLines = lines.filter((line) => /^\d+\.\s+/.test(line))
  if (lines.length > 0 && numberedLines.length === lines.length) {
    return (
      <ol key={`ol-${index}`} className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">
        {lines.map((line, lineIndex) => (
          <li key={`oli-${index}-${lineIndex}`} className="pl-1">
            {renderInlineCivilAiMarkdown(line.replace(/^\d+\.\s+/, ''))}
          </li>
        ))}
      </ol>
    )
  }

  return <p key={`p-${index}`} className="mb-3 last:mb-0">{renderInlineCivilAiMarkdown(trimmed)}</p>
}

function CivilAiMessageBody({ content }: { content: string }) {
  return <Fragment>{content.split(/\n\s*\n/).map((block, index) => renderCivilAiBlock(block, index))}</Fragment>
}

function CivilAiReferenceCard({ reference }: { reference: CivilAiReference }) {
  const body = (
    <div className="flex gap-3 p-3">
      <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
        {reference.imageUrl ? <img src={reference.imageUrl} alt={reference.title} className="h-full w-full object-cover" loading="lazy" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {reference.badge ? <span className="rounded-full border border-[var(--cc-primary)]/15 bg-[var(--cc-primary)]/8 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-primary)]">{reference.badge}</span> : null}
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Civil</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[var(--cc-primary)]">{reference.title}</p>
        {reference.subtitle ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{reference.subtitle}</p> : null}
        {reference.summary ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{reference.summary}</p> : null}
      </div>
    </div>
  )

  const className = 'group block overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-sm transition hover:border-[var(--cc-primary)]/30 hover:bg-slate-50'

  if (isCivilInternalHref(reference.href)) {
    return (
      <Link href={toCivilAppHref(reference.href)} className={className}>
        {body}
      </Link>
    )
  }

  return (
    <a href={reference.href} className={className} target="_blank" rel="noreferrer">
      {body}
    </a>
  )
}

export default function CivilAiLauncher() {
  const pathname = usePathname()
  const resolvedPathname = pathname || ''
  const me = useViewerStore((state) => state.me)
  const familyView = useViewerStore((state) => state.familyView)
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [messages, setMessages] = useState<AiMessage[]>([STARTER_MESSAGE])
  const [draft, setDraft] = useState('')
  const [sendLoading, setSendLoading] = useState(false)
  const [stopLoading, setStopLoading] = useState(false)
  const [loadingSteps, setLoadingSteps] = useState<string[]>([])
  const [loadingStepIndex, setLoadingStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const sendLoadingRef = useRef(false)
  const activeRequestControllerRef = useRef<AbortController | null>(null)
  const activeJobIdRef = useRef<string | null>(null)
  const launcherHiddenForRoute =
    CIVIL_AI_HIDDEN_PATHS.has(resolvedPathname) ||
    resolvedPathname === '/privacy' ||
    resolvedPathname === '/terms' ||
    resolvedPathname === '/safety' ||
    resolvedPathname === '/help' ||
    resolvedPathname.startsWith('/welcome') ||
    resolvedPathname.startsWith('/verify')
  const hasCompleteAccount = Boolean(me && hasHomeCommunity(me) && hasDeclaredCivilStatus(me))
  const isFamilyLockedSession = Boolean(familyView) || me?.accountType === 'family_member'
  const shouldHideLauncher = launcherHiddenForRoute || !hasCompleteAccount || isFamilyLockedSession

  const resetCivilAiSession = useCallback(() => {
    activeRequestControllerRef.current?.abort()
    activeRequestControllerRef.current = null
    activeJobIdRef.current = null
    const nextConversationId = createCivilAiConversationId()
    setConversationId(nextConversationId)
    setMessages([STARTER_MESSAGE])
    setDraft('')
    setSendLoading(false)
    setStopLoading(false)
    setLoadingSteps([])
    setLoadingStepIndex(0)
    setError(null)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(CIVIL_AI_CONVERSATION_STORAGE_KEY, nextConversationId)
    }
  }, [])

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort()
      activeRequestControllerRef.current = null
      activeJobIdRef.current = null
    }
  }, [])

  useEffect(() => {
    if (shouldHideLauncher && open) {
      setOpen(false)
      resetCivilAiSession()
    }
  }, [open, resetCivilAiSession, shouldHideLauncher])

  useEffect(() => {
    sendLoadingRef.current = sendLoading
  }, [sendLoading])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setOpen(window.sessionStorage.getItem(CIVIL_AI_OPEN_STORAGE_KEY) === 'true')
    const nextConversationId = createCivilAiConversationId()
    window.sessionStorage.setItem(CIVIL_AI_CONVERSATION_STORAGE_KEY, nextConversationId)
    setConversationId(nextConversationId)
  }, [])

  useEffect(() => {
    const handleOpen = () => {
      if (isFamilyLockedSession) return
      setOpen(true)
    }
    window.addEventListener('civil-ai:open', handleOpen)
    return () => window.removeEventListener('civil-ai:open', handleOpen)
  }, [isFamilyLockedSession])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(CIVIL_AI_OPEN_STORAGE_KEY, open ? 'true' : 'false')
    }
    window.dispatchEvent(new CustomEvent('civil-ai:state', { detail: { open } }))
  }, [open])

  useEffect(() => {
    if (!open) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open, sendLoading])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!sendLoading || loadingSteps.length <= 1) return

    setLoadingStepIndex(0)
    const interval = window.setInterval(() => {
      setLoadingStepIndex((current) => {
        if (current >= loadingSteps.length - 1) return current
        return current + 1
      })
    }, 1800)

    return () => window.clearInterval(interval)
  }, [sendLoading, loadingSteps])

  const pollCivilAiJob = useCallback(async (args: { jobId: string; token: string | null; signal: AbortSignal }) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < CIVIL_AI_POLL_TIMEOUT_MS) {
      const response = await fetch(buildApiUrl(`/ai/chat/jobs/${encodeURIComponent(args.jobId)}`), {
        headers: {
          ...(args.token ? { authorization: `Bearer ${args.token}` } : {}),
        },
        cache: 'no-store',
        signal: args.signal,
      })
      const { json, text } = await parseApiResponse<AiChatJobPollResponse>(response)
      if (!response.ok) {
        throw new Error(json?.error || text || 'Civil AI job status could not be loaded.')
      }
      if (json?.status === 'completed' && json.message?.content) {
        return json
      }
      if (json?.status === 'failed') {
        throw new Error(json.error || 'Civil AI could not answer right now.')
      }
      if (json?.status === 'cancelled') {
        throw new Error('Civil AI request stopped.')
      }
      await waitForCivilAiPollDelay(1200, args.signal)
    }

    throw new Error('Civil AI is still working. Please try again in a moment.')
  }, [])

  const handleStop = useCallback(async () => {
    const jobId = activeJobIdRef.current
    if (!jobId || stopLoading) return

    setStopLoading(true)
    try {
      const token = getStoredToken()
      await fetch(buildApiUrl(`/ai/chat/jobs/${encodeURIComponent(jobId)}`), {
        method: 'DELETE',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      })
    } catch {
    } finally {
      activeRequestControllerRef.current?.abort()
      activeRequestControllerRef.current = null
      activeJobIdRef.current = null
      setStopLoading(false)
      setSendLoading(false)
      setLoadingSteps([])
      setLoadingStepIndex(0)
    }
  }, [stopLoading])

  async function handleSend() {
    const content = draft.trim()
    if (!content || sendLoading) return

    const nextUserMessage: AiMessage = {
      id: nextMessageId('user'),
      role: 'user',
      content,
    }
    const nextConversationId = createCivilAiConversationId()
    const nextMessages = [nextUserMessage]

    setMessages(nextMessages)
    setDraft('')
    setSendLoading(true)
    setLoadingSteps(buildCivilAiLoadingSteps(content))
    setLoadingStepIndex(0)
    setError(null)
    setConversationId(nextConversationId)

    try {
      const token = getStoredToken()
      activeRequestControllerRef.current?.abort()
      const requestController = new AbortController()
      activeRequestControllerRef.current = requestController
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(CIVIL_AI_CONVERSATION_STORAGE_KEY, nextConversationId)
      }
      const response = await fetch(buildApiUrl('/ai/chat'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          conversationId: nextConversationId,
          messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        }),
        signal: requestController.signal,
      })
      const { json, text } = await parseApiResponse<AiChatJobCreateResponse>(response)
      if (!response.ok || !json?.jobId) {
        throw new Error(text || 'Civil AI could not start right now.')
      }
      activeJobIdRef.current = json.jobId
      const jobResult = await pollCivilAiJob({
        jobId: json.jobId,
        token,
        signal: requestController.signal,
      })
      if (typeof window !== 'undefined' && jobResult.conversationId) {
        window.sessionStorage.setItem(CIVIL_AI_CONVERSATION_STORAGE_KEY, jobResult.conversationId)
        setConversationId(jobResult.conversationId)
      }
      setMessages((current) => pruneCivilAiMessages([
        ...current,
        {
          id: nextMessageId('assistant'),
          role: 'assistant',
          content: jobResult.message?.content || 'No response returned.',
          references: Array.isArray(jobResult.message?.references) ? jobResult.message?.references : [],
        },
      ]))
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === 'AbortError') {
        return
      }
      setError(sendError instanceof Error ? sendError.message : 'Civil AI could not answer right now.')
    } finally {
      activeRequestControllerRef.current = null
      activeJobIdRef.current = null
      setSendLoading(false)
      setStopLoading(false)
      setLoadingSteps([])
      setLoadingStepIndex(0)
    }
  }

  function handleDraftKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void handleSend()
  }

  function handleClose() {
    setOpen(false)
    resetCivilAiSession()
  }

  if (shouldHideLauncher) {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cc-civil-ai-launcher fixed bottom-6 right-6 z-[45] hidden h-[4.35rem] w-[4.35rem] items-center justify-center rounded-[1.55rem] transition hover:scale-[1.02] lg:flex"
        aria-label="Open Civil AI"
      >
        <span className="cc-civil-ai-launcher__border" aria-hidden="true" />
        <span className="cc-civil-ai-launcher__surface">
          <img src="/PWA-ICON.png?v=20260306" alt="Civil AI" className="h-[3.2rem] w-[3.2rem] object-contain" />
        </span>
      </button>

      {open ? (
        <div className="pointer-events-none fixed inset-y-0 right-0 z-[45] w-full sm:w-[min(460px,100vw)]">
          <section className="pointer-events-auto absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:rounded-l-[2rem]">
            <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fff8f7_100%)] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--cc-primary)]/10 bg-white p-1 shadow-[0_8px_18px_rgba(213,43,30,0.1)]">
                    <img src="/PWA-ICON.png?v=20260306" alt="Civil AI" className="h-full w-full rounded-xl object-contain" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--cc-primary)]">Civil AI</p>
                    <h2 className="mt-1 max-w-[14rem] text-[1.05rem] font-semibold leading-[1.05] tracking-[-0.02em] text-slate-900 sm:max-w-[16rem] sm:text-[1.2rem]">Intelligence for a Civil Society.</h2>
                    <p className="mt-1 max-w-[18rem] text-[13px] leading-5 text-slate-600 sm:max-w-[22rem]">Ask about topics, communities, posts, events, and what’s happening near you.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:border-[var(--cc-primary)]/30 hover:text-[var(--cc-primary)]"
                  onClick={handleClose}
                  aria-label="Close Civil AI"
                >
                  <HiOutlineXMark className="text-xl" />
                </button>
              </div>

            </div>

            <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(213,43,30,0.05),_transparent_34%)] px-4 py-4">
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={clsx('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div className="max-w-[88%] space-y-2">
                      <div
                        className={clsx(
                          'rounded-[1.4rem] px-4 py-3 text-sm leading-6 shadow-[0_10px_28px_rgba(15,23,42,0.08)]',
                          message.role === 'user'
                            ? 'bg-[var(--cc-primary)] text-white'
                            : 'border border-slate-200 bg-white text-slate-800',
                        )}
                      >
                        <CivilAiMessageBody content={message.content} />
                      </div>
                      {message.role === 'assistant' && message.references?.length ? (
                        <div className="space-y-2">
                          {message.references.map((reference) => (
                            <CivilAiReferenceCard key={`${reference.kind}-${reference.id}`} reference={reference} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}

                {sendLoading ? (
                  <div className="flex justify-start">
                    <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <HiOutlineArrowPath className="animate-spin text-[var(--cc-primary)]" />
                        Civil AI is thinking
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {loadingSteps[loadingStepIndex] || 'Looking up the best matching Civil data.'}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-slate-200 bg-white/90 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur-sm">
              {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
              <div className="rounded-[1.6rem] border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleDraftKeyDown}
                  placeholder="Ask Civil AI something useful"
                  rows={2}
                  disabled={sendLoading}
                  className="min-h-[68px] w-full resize-none bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="flex items-center justify-end gap-3 px-2 pb-1">
                  {sendLoading ? (
                    <button
                      type="button"
                      onClick={() => void handleStop()}
                      disabled={stopLoading}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--cc-primary)]/30 hover:text-[var(--cc-primary)] disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                    >
                      {stopLoading ? 'Stopping...' : 'Stop'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || sendLoading}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--cc-primary)] text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-300"
                    aria-label="Send Civil AI message"
                  >
                    <HiOutlineArrowUp className="text-xl" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}