'use client'

import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { HiOutlineArrowUp, HiOutlineSparkles, HiOutlineXMark } from 'react-icons/hi2'
import { buildApiUrl, parseApiResponse } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'

type AiMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
}

type AiHistoryResponse = {
  items: Array<{
    role: 'assistant' | 'user'
    content: string
    createdAt: string
  }>
}

type AiChatResponse = {
  message?: {
    role?: string
    content?: string
  } | null
}

const STARTER_MESSAGE = {
  id: 'civil-ai-intro',
  role: 'assistant' as const,
  content:
    'I am Civil AI. Ask about a community issue, a civic process, or what to do next inside Civil Citizens.',
}

const QUICK_PROMPTS = [
  'Summarize what matters in my community feed.',
  'Help me write a civic update people will actually read.',
  'Explain a local issue in plain language.',
]

const CIVIL_AI_OPEN_STORAGE_KEY = 'civil-ai-open'

function nextMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function CivilAiLauncher() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([STARTER_MESSAGE])
  const [draft, setDraft] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setOpen(window.sessionStorage.getItem(CIVIL_AI_OPEN_STORAGE_KEY) === 'true')
  }, [])

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener('civil-ai:open', handleOpen)
    return () => window.removeEventListener('civil-ai:open', handleOpen)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(CIVIL_AI_OPEN_STORAGE_KEY, open ? 'true' : 'false')
    }
    window.dispatchEvent(new CustomEvent('civil-ai:state', { detail: { open } }))
  }, [open])

  useEffect(() => {
    if (!open) return
    void loadHistory()
  }, [open])

  useEffect(() => {
    if (!open) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open, sendLoading])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  async function loadHistory() {
    setHistoryLoading(true)
    setError(null)
    try {
      const token = getStoredToken()
      const response = await fetch(buildApiUrl('/ai/history'), {
        cache: 'no-store',
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      })
      const { json, text } = await parseApiResponse<AiHistoryResponse>(response)
      if (!response.ok || !json) {
        throw new Error(text || 'Unable to load Civil AI history right now.')
      }
      setMessages(
        json.items.length
          ? json.items.map((item, index) => ({
              id: `history-${index}-${item.createdAt}`,
              role: item.role,
              content: item.content,
            }))
          : [STARTER_MESSAGE],
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Civil AI history right now.')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function handleSend() {
    const content = draft.trim()
    if (!content || sendLoading) return

    const nextUserMessage: AiMessage = {
      id: nextMessageId('user'),
      role: 'user',
      content,
    }
    const nextMessages = [...messages, nextUserMessage]

    setMessages(nextMessages)
    setDraft('')
    setSendLoading(true)
    setError(null)

    try {
      const token = getStoredToken()
      const response = await fetch(buildApiUrl('/ai/chat'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: nextMessages
            .filter((message) => message.id !== STARTER_MESSAGE.id)
            .map((message) => ({ role: message.role, content: message.content })),
        }),
      })
      const { json, text } = await parseApiResponse<AiChatResponse>(response)
      if (!response.ok || !json?.message?.content) {
        throw new Error(text || 'Civil AI did not return a usable response.')
      }
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId('assistant'),
          role: 'assistant',
          content: json.message?.content || 'No response returned.',
        },
      ])
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Civil AI could not answer right now.')
    } finally {
      setSendLoading(false)
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void handleSend()
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
          <img src="/PWA-ICON.png?v=20260306" alt="Civil AI" className="h-11 w-11 object-contain" />
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
                  onClick={() => setOpen(false)}
                  aria-label="Close Civil AI"
                >
                  <HiOutlineXMark className="text-xl" />
                </button>
              </div>

            </div>

            <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(213,43,30,0.05),_transparent_34%)] px-4 py-4">
              <div className="mb-4 flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setDraft(prompt)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 shadow-sm transition hover:border-[var(--cc-primary)]/35 hover:bg-[var(--cc-primary)]/5 hover:text-[var(--cc-primary)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={clsx('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={clsx(
                        'max-w-[88%] rounded-[1.4rem] px-4 py-3 text-sm leading-6 shadow-[0_10px_28px_rgba(15,23,42,0.08)]',
                        message.role === 'user'
                          ? 'bg-[var(--cc-primary)] text-white'
                          : 'border border-slate-200 bg-white text-slate-800',
                      )}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}

                {sendLoading ? (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                      <HiOutlineSparkles className="text-[var(--cc-primary)]" />
                      Civil AI is thinking
                    </div>
                  </div>
                ) : null}

                {historyLoading ? (
                  <div className="flex justify-start">
                    <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                      Loading recent chat
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
                  className="min-h-[68px] w-full resize-none bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="flex items-center justify-end gap-3 px-2 pb-1">
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