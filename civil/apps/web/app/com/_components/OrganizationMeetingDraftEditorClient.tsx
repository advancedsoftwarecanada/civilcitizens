'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'

const MAX_MEETING_PARTICIPANTS = 10

type MeetingRecord = {
  id: string
  title: string
  description: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  maxParticipants: number | null
  requiresPassword: boolean
  requiresManualAdmit: boolean
  status: 'ACTIVE' | 'ARCHIVED'
  schedule?: {
    startsAt?: string | null
    endsAt?: string | null
  }
}

type MeetingResponse = {
  meeting?: MeetingRecord
  error?: unknown
}

function normalizeMeetingDraft(meeting: MeetingRecord): MeetingRecord {
  const maxParticipants =
    typeof meeting.maxParticipants === 'number' && Number.isFinite(meeting.maxParticipants)
      ? Math.max(1, Math.min(MAX_MEETING_PARTICIPANTS, Math.trunc(meeting.maxParticipants)))
      : MAX_MEETING_PARTICIPANTS
  return {
    ...meeting,
    maxParticipants,
  }
}

export default function OrganizationMeetingDraftEditorClient({
  province,
  municipality,
  slug,
  meetingId,
}: {
  province: string
  municipality: string
  slug: string
  meetingId?: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'creating' | 'loading' | 'ready' | 'saving' | 'error'>('idle')
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null)
  const [password, setPassword] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const baseManagePath = useMemo(
    () => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/meetings/manage`,
    [province, municipality, slug],
  )

  const ensureDraft = useCallback(async () => {
    if (meetingId) return meetingId
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return null
    }

    setStatus('creating')
    try {
      const res = await fetch(
        buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/meetings`),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Untitled meeting',
            description: null,
            visibility: 'PUBLIC',
            requiresPassword: false,
            password: null,
            requiresManualAdmit: false,
            maxParticipants: MAX_MEETING_PARTICIPANTS,
            schedule: null,
            assignedMemberUserIds: [],
            status: 'ARCHIVED',
          }),
        },
      )
      const { json, text } = await parseApiResponse<any>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return null
      }
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : text || 'Unable to create meeting draft.'
        pushToast(message, 'error')
        setStatus('error')
        return null
      }
      const createdId = String(json?.meeting?.id || '')
      if (!createdId) {
        pushToast('Draft created, but missing meeting id.', 'error')
        setStatus('error')
        return null
      }

      router.replace(`${baseManagePath}/${encodeURIComponent(createdId)}`)
      return createdId
    } catch (err) {
      console.error('meeting_draft_create_failed', err)
      pushToast('Unable to create meeting draft right now.', 'error')
      setStatus('error')
      return null
    }
  }, [baseManagePath, meetingId, municipality, province, router, slug])

  const load = useCallback(
    async (id: string) => {
      setStatus('loading')
      try {
        const token = getStoredToken()
        if (!token) {
          redirectToAuthModal('login')
          return
        }
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/meetings/${encodeURIComponent(id)}`,
          ),
          {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          },
        )
        if (res.status === 401) {
          redirectToAuthModal('login')
          return
        }
        const { json, text } = await parseApiResponse<MeetingResponse>(res)
        if (!res.ok || !json?.meeting) {
          console.warn('meeting_load_failed', json || text)
          setStatus('error')
          pushToast(typeof (json as any)?.error === 'string' ? String((json as any).error) : text || 'Unable to load meeting draft.', 'error')
          if (res.status === 403 || res.status === 404) {
            router.push(baseManagePath)
          }
          return
        }
        setMeeting(normalizeMeetingDraft(json.meeting))
        setPassword('')
        setStatus('ready')
      } catch (err) {
        console.error('meeting_load_failed', err)
        setStatus('error')
      }
    },
    [baseManagePath, municipality, province, router, slug],
  )

  useEffect(() => {
    ;(async () => {
      const id = await ensureDraft()
      if (id) await load(id)
    })()
  }, [ensureDraft, load])

  const save = useCallback(
    async (updates: Partial<MeetingRecord> & { password?: string | null }) => {
      if (!meeting) return
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      setStatus('saving')
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/meetings/${encodeURIComponent(meeting.id)}`,
          ),
          {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: updates.title,
              description: updates.description,
              visibility: updates.visibility,
              maxParticipants: MAX_MEETING_PARTICIPANTS,
              requiresPassword: updates.requiresPassword,
              password: updates.password,
              requiresManualAdmit: updates.requiresManualAdmit,
              status: updates.status,
            }),
          },
        )
        const { json, text } = await parseApiResponse<any>(res)
        if (res.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!res.ok) {
          const message = typeof json?.error === 'string' ? json.error : text || 'Unable to save meeting.'
          pushToast(message, 'error')
          setStatus('ready')
          return
        }
        if (json?.meeting) {
          setMeeting(normalizeMeetingDraft(json.meeting))
        }
        setPassword('')
        pushToast('Saved.', 'success')
        setStatus('ready')
      } catch (err) {
        console.error('meeting_save_failed', err)
        pushToast('Unable to save meeting right now.', 'error')
        setStatus('ready')
      }
    },
    [meeting, municipality, province, slug],
  )

  const remove = useCallback(async () => {
    if (!meeting) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/governance/meetings/${encodeURIComponent(
            meeting.id,
          )}`,
        ),
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      )
      const { json, text } = await parseApiResponse<any>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : text || 'Unable to delete meeting.'
        pushToast(message, 'error')
        return
      }
      pushToast('Meeting deleted.', 'success')
      router.push(baseManagePath)
      router.refresh()
    } catch (err) {
      console.error('meeting_delete_failed', err)
      pushToast('Unable to delete meeting right now.', 'error')
    } finally {
      setDeleting(false)
      setDeleteModalOpen(false)
    }
  }, [baseManagePath, meeting, municipality, province, router, slug])

  if (status === 'creating') return <p className="text-sm text-slate-500">Creating draft…</p>
  if (status === 'loading' || status === 'idle') return <p className="text-sm text-slate-500">Loading draft…</p>
  if (status === 'error' || !meeting) return <p className="text-sm text-slate-500">Unable to load this meeting draft.</p>

  const isBusy = status === 'saving' || deleting

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Status:</span>
            <select
              data-testid="meeting-status-select"
              value={meeting.status}
              onChange={(event) => setMeeting({ ...meeting, status: event.target.value as 'ACTIVE' | 'ARCHIVED' })}
              disabled={isBusy}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            >
              <option value="ARCHIVED">Unpublished</option>
              <option value="ACTIVE">Published</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              data-testid="meeting-save-button"
              type="button"
              onClick={() =>
                save({
                  ...meeting,
                  maxParticipants: MAX_MEETING_PARTICIPANTS,
                  password: meeting.requiresPassword ? (password.trim() ? password.trim() : undefined) : null,
                })
              }
              disabled={isBusy}
              className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {status === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button
              data-testid="meeting-delete-button"
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              disabled={isBusy}
              className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Title</span>
            <input
              data-testid="meeting-title-input"
              value={meeting.title}
              onChange={(e) => setMeeting({ ...meeting, title: e.target.value })}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</span>
            <textarea
              value={meeting.description || ''}
              onChange={(e) => setMeeting({ ...meeting, description: e.target.value || null })}
              rows={4}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Visibility</span>
              <select
                data-testid="meeting-visibility-select"
                value={meeting.visibility}
                onChange={(e) => setMeeting({ ...meeting, visibility: e.target.value as 'PUBLIC' | 'PRIVATE' })}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Organization Only</option>
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Max participants</span>
              <input
                data-testid="meeting-max-participants-input"
                type="number"
                value={MAX_MEETING_PARTICIPANTS}
                disabled
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div data-testid="meeting-manual-admit-card" className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={meeting.requiresManualAdmit}
                  onChange={(e) => setMeeting({ ...meeting, requiresManualAdmit: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Manual admit
              </label>
              <p className="mt-2 text-xs text-slate-500">Hosts must approve users before they can fully enter the room.</p>
            </div>

            <div data-testid="meeting-password-card" className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={meeting.requiresPassword}
                  onChange={(e) => setMeeting({ ...meeting, requiresPassword: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Require password
              </label>
              {meeting.requiresPassword ? (
                <div className="mt-2 grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Password</span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Set a new password"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <p className="text-xs text-slate-500">Leave blank to keep the current password.</p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Allow room access without a password challenge.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/meetings`)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Back to meetings
        </button>
      </div>

      {deleteModalOpen ? (
        <div
          data-testid="meeting-delete-modal"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
          onClick={() => (!deleting ? setDeleteModalOpen(false) : null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-slate-900">Delete meeting?</h4>
            <p className="mt-2 text-sm text-slate-600">This removes the meeting room and its assignments.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                data-testid="meeting-delete-confirm-button"
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
