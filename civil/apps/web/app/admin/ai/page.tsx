"use client"

import { useCallback, useEffect, useState } from 'react'
import AdminWideShell from '../_components/AdminWideShell'
import { buildApiUrl } from '../../_lib/api'
import { useAdminAccess } from '../_hooks/useAdminAccess'

type AdminAiConversationSummary = {
  id: string
  userId: string | null
  userHandle: string | null
  userName: string | null
  startedAt: string
  lastActivityAt: string
  turnCount: number
  firstUserMessage: string | null
  lastUserMessage: string | null
  status: string | null
  lastModel: string | null
  lastServer: string | null
  lastServerBaseUrl: string | null
  lastError: string | null
}

type AdminAiTurn = {
  id: string
  conversationId: string
  userId: string | null
  createdAt: string
  latestUserMessage: string | null
  status: string
  durationMs: number | null
  serverName: string | null
  serverBaseUrl: string | null
  model: string | null
  errorMessage: string | null
  assistantContent: string | null
  requestMessages: unknown
  viewerContext: unknown
  retrievalDebug: unknown
  references: unknown
  upstreamInput: string | null
  rawResponse: unknown
}

type AdminAiConversationListResponse = {
  items: AdminAiConversationSummary[]
}

type AdminAiConversationDetailResponse = {
  aiConfig: {
    publicHost: string
    publicBaseUrl: string
    defaultServerId: string
    configPath: string
    activeServer: {
      id: string
      name: string
      baseUrl: string
      provider: string | null
      enabled: boolean
      default: boolean
    } | null
    servers: Array<{
      id: string
      name: string
      baseUrl: string
      provider: string | null
      enabled: boolean
      default: boolean
    }>
  }
  conversation: AdminAiConversationSummary
  turns: AdminAiTurn[]
}

type AdminAiSourceFilter = 'all' | 'direct' | 'grounded' | 'model' | 'error'

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function formatJson(value: unknown) {
  if (value == null) return 'null'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getAiAnswerSource(status: string | null | undefined, retrievalDebug?: unknown) {
  if (status === 'direct_answer') {
    return { label: 'Direct', tone: 'bg-emerald-100 text-emerald-700' }
  }
  if (status === 'grounded_answer') {
    return { label: 'Grounded', tone: 'bg-sky-100 text-sky-700' }
  }
  if (status === 'completed') {
    return { label: 'Model', tone: 'bg-violet-100 text-violet-700' }
  }
  if (retrievalDebug && typeof retrievalDebug === 'object' && !Array.isArray(retrievalDebug)) {
    const candidate = retrievalDebug as { directAnswerUsed?: boolean; groundedAnswerUsed?: boolean }
    if (candidate.directAnswerUsed) {
      return { label: 'Direct', tone: 'bg-emerald-100 text-emerald-700' }
    }
    if (candidate.groundedAnswerUsed) {
      return { label: 'Grounded', tone: 'bg-sky-100 text-sky-700' }
    }
  }
  return { label: 'Error', tone: 'bg-rose-100 text-rose-700' }
}

export default function AdminAiPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [items, setItems] = useState<AdminAiConversationSummary[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminAiConversationDetailResponse | null>(null)
  const [sourceFilter, setSourceFilter] = useState<AdminAiSourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState('')

  const loadConversations = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch(buildApiUrl('/admin/ai/conversations?limit=50'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setItems([])
        setMessage('Unable to load Civil AI conversations.')
        return
      }
      const payload = (await res.json().catch(() => null)) as AdminAiConversationListResponse | null
      const nextItems = Array.isArray(payload?.items) ? payload.items : []
      setItems(nextItems)
      setSelectedConversationId((current) => current ?? nextItems[0]?.id ?? null)
      setLastUpdatedAt(new Date().toISOString())
    } catch {
      setItems([])
      setMessage('Unable to load Civil AI conversations.')
    } finally {
      setLoading(false)
    }
  }, [token])

  const loadDetail = useCallback(
    async (conversationId: string) => {
      if (!token) return
      setDetailLoading(true)
      setMessage(null)
      try {
        const res = await fetch(buildApiUrl(`/admin/ai/conversations/${encodeURIComponent(conversationId)}`), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!res.ok) {
          setDetail(null)
          setMessage('Unable to load Civil AI conversation detail.')
          return
        }
        const payload = (await res.json().catch(() => null)) as AdminAiConversationDetailResponse | null
        setDetail(payload ?? null)
        setLastUpdatedAt(new Date().toISOString())
      } catch {
        setDetail(null)
        setMessage('Unable to load Civil AI conversation detail.')
      } finally {
        setDetailLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    void loadConversations()
  }, [isSuperAdmin, loadConversations, token])

  useEffect(() => {
    if (!selectedConversationId || !isSuperAdmin || !token) return
    void loadDetail(selectedConversationId)
  }, [isSuperAdmin, loadDetail, selectedConversationId, token])

  const filteredItems = items.filter((conversation) => {
    const source = getAiAnswerSource(conversation.status).label.toLowerCase()
    const normalizedStatusFilter = statusFilter.trim().toLowerCase()
    const sourceMatches = sourceFilter === 'all' ? true : source === sourceFilter
    const statusMatches = normalizedStatusFilter
      ? (conversation.status ?? '').toLowerCase().includes(normalizedStatusFilter)
      : true
    return sourceMatches && statusMatches
  })

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedConversationId(null)
      setDetail(null)
      return
    }
    if (!selectedConversationId || !filteredItems.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(filteredItems[0]?.id ?? null)
    }
  }, [filteredItems, selectedConversationId])

  const body = () => {
    if (accessLoading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Authorizing admin tools…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }

    return (
      <>
        <section className="surface-card flex flex-wrap items-center justify-between gap-4 px-6 py-5 shadow-subtle">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Admin</p>
            <h1 className="text-2xl font-semibold text-slate-900">Civil AI debug console</h1>
            <p className="text-sm text-slate-600">
              Review AI conversations, direct answers, retrieval decisions, prompt inputs, and returned content.
            </p>
            <p className="text-xs text-slate-400">{lastUpdatedAt ? `Last updated ${formatDateTime(lastUpdatedAt)}. Manual refresh only.` : 'Waiting for first refresh. Manual refresh only.'}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadConversations()}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </section>

        <section className="surface-card flex flex-wrap items-center gap-3 px-6 py-4 shadow-subtle">
          <div className="flex flex-wrap gap-2">
            {([
              ['all', 'All'],
              ['direct', 'Direct'],
              ['grounded', 'Grounded'],
              ['model', 'Model'],
              ['error', 'Error'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSourceFilter(value)}
                className={`rounded-full px-3 py-2 text-sm font-medium transition ${sourceFilter === value ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            placeholder="Filter by raw status"
            className="min-w-[220px] flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
        </section>

        {message ? <section className="surface-card border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-700">{message}</section> : null}

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="surface-card overflow-hidden shadow-subtle">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Conversations</h2>
              <p className="mt-1 text-sm text-slate-500">Latest 50 Civil AI conversations. Showing {filteredItems.length} of {items.length}.</p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {!filteredItems.length ? (
                <div className="px-5 py-6 text-sm text-slate-500">{loading ? 'Loading conversations…' : items.length ? 'No conversations match the current filters.' : 'No Civil AI conversations logged yet.'}</div>
              ) : (
                filteredItems.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={`w-full border-b border-slate-100 px-5 py-4 text-left transition ${selectedConversationId === conversation.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-900 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-semibold ${selectedConversationId === conversation.id ? 'text-white' : 'text-slate-900'}`}>
                          {conversation.userName || conversation.userHandle || 'Anonymous user'}
                        </p>
                        <p className={`mt-1 truncate text-xs ${selectedConversationId === conversation.id ? 'text-slate-200' : 'text-slate-500'}`}>
                          {conversation.userHandle ? `@${conversation.userHandle}` : 'No handle'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${selectedConversationId === conversation.id ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {conversation.status ?? 'unknown'}
                        </span>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${selectedConversationId === conversation.id ? 'bg-white/10 text-white' : getAiAnswerSource(conversation.status).tone}`}>
                          {getAiAnswerSource(conversation.status).label}
                        </span>
                      </div>
                    </div>
                    <p className={`mt-3 line-clamp-2 text-sm ${selectedConversationId === conversation.id ? 'text-slate-100' : 'text-slate-600'}`}>
                      {conversation.lastUserMessage || conversation.firstUserMessage || 'No user message captured.'}
                    </p>
                    <div className={`mt-3 flex flex-wrap gap-3 text-[11px] ${selectedConversationId === conversation.id ? 'text-slate-200' : 'text-slate-400'}`}>
                      <span>{conversation.turnCount} turns</span>
                      <span>{formatDateTime(conversation.lastActivityAt)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            {detailLoading ? (
              <section className="surface-card px-6 py-5 text-sm text-slate-500 shadow-subtle">Loading conversation detail…</section>
            ) : !detail ? (
              <section className="surface-card px-6 py-5 text-sm text-slate-500 shadow-subtle">Select a conversation to inspect Civil AI decisions.</section>
            ) : (
              <>
                <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">Conversation detail</h2>
                      <p className="mt-1 text-sm text-slate-500">{detail.conversation.userName || detail.conversation.userHandle || 'Anonymous user'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
                      ID: {detail.conversation.id}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Started</p>
                      <p className="mt-2 text-sm text-slate-700">{formatDateTime(detail.conversation.startedAt)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Last activity</p>
                      <p className="mt-2 text-sm text-slate-700">{formatDateTime(detail.conversation.lastActivityAt)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Turns</p>
                      <p className="mt-2 text-sm text-slate-700">{detail.conversation.turnCount}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Last model</p>
                      <p className="mt-2 text-sm text-slate-700">{detail.conversation.lastModel ?? 'Direct answer / unavailable'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Answer source</p>
                      <p className="mt-2 text-sm text-slate-700">{getAiAnswerSource(detail.conversation.status).label}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 md:col-span-2 xl:col-span-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Public host</p>
                      <p className="mt-2 text-sm text-slate-700">{detail.aiConfig.publicBaseUrl}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 md:col-span-2 xl:col-span-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Active LM Studio</p>
                      <p className="mt-2 text-sm text-slate-700">
                        {detail.aiConfig.activeServer ? `${detail.aiConfig.activeServer.name} (${detail.aiConfig.activeServer.baseUrl})` : 'No active server configured'}
                      </p>
                    </div>
                  </div>
                  {detail.conversation.lastError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      Last error: {detail.conversation.lastError}
                    </div>
                  ) : null}
                </section>

                <section className="space-y-4">
                  {detail.turns.map((turn) => (
                    <article key={turn.id} className="surface-card px-6 py-5 shadow-subtle">
                      {(() => {
                        const answerSource = getAiAnswerSource(turn.status, turn.retrievalDebug)
                        return (
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Turn</p>
                          <h3 className="mt-2 text-base font-semibold text-slate-900">{turn.latestUserMessage || 'No user message captured.'}</h3>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold uppercase tracking-[0.18em] text-slate-600">{turn.status}</span>
                          <span className={`rounded-full px-3 py-1 font-semibold uppercase tracking-[0.18em] ${answerSource.tone}`}>{answerSource.label}</span>
                          {turn.durationMs != null ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">{turn.durationMs} ms</span> : null}
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">{formatDateTime(turn.createdAt)}</span>
                        </div>
                      </div>
                        )
                      })()}

                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Model</p>
                          <p className="mt-2 text-sm text-slate-700">{turn.model ?? 'Direct answer / unavailable'}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Server</p>
                          <p className="mt-2 text-sm text-slate-700">{turn.serverName ?? 'Local direct path'}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Server target</p>
                          <p className="mt-2 text-sm text-slate-700">{turn.serverBaseUrl ?? detail.conversation.lastServerBaseUrl ?? 'No LM Studio target recorded'}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Error</p>
                          <p className="mt-2 text-sm text-slate-700">{turn.errorMessage ?? 'None'}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Answer source</p>
                          <p className="mt-2 text-sm text-slate-700">{getAiAnswerSource(turn.status, turn.retrievalDebug).label}</p>
                        </div>
                      </div>

                      {turn.assistantContent ? (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Assistant content</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{turn.assistantContent}</p>
                        </div>
                      ) : null}

                      <div className="mt-4 space-y-3">
                        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Retrieval debug</summary>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{formatJson(turn.retrievalDebug)}</pre>
                        </details>
                        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Viewer context</summary>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{formatJson(turn.viewerContext)}</pre>
                        </details>
                        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Request messages</summary>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{formatJson(turn.requestMessages)}</pre>
                        </details>
                        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">References</summary>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{formatJson(turn.references)}</pre>
                        </details>
                        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Upstream input</summary>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{turn.upstreamInput ?? 'No upstream model input was used for this turn.'}</pre>
                        </details>
                        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{formatJson(turn.rawResponse)}</pre>
                        </details>
                      </div>
                    </article>
                  ))}
                </section>
              </>
            )}
          </div>
        </section>
      </>
    )
  }

  return (
    <AdminWideShell className="bg-slate-50" mainClassName="space-y-6">
      {body()}
    </AdminWideShell>
  )
}
