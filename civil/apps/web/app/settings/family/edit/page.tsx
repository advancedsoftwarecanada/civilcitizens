'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import clsx from 'clsx'
import {
  HiOutlineArrowPath,
  HiOutlineExclamationTriangle,
  HiOutlineInformationCircle,
  HiOutlineUserGroup,
} from 'react-icons/hi2'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { buildFamilyAvatarDataUrl, buildFamilyCoverDataUrl } from '../../../_lib/familyIdentity'
import { applyFamilyMemberMedia, getFamilyMediaLabel, uploadFamilyMediaAsset, validateFamilyMediaFile, waitForFamilyMediaAsset, type FamilyMediaCategory } from '../../../_lib/familyMedia'

type FamilyEditorItem = {
  id: string
  kind: 'draft' | 'member'
  firstName: string
  lastName: string
  relationship: string
  dateOfBirth: string
  friendCode: string | null
  username?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  allowChildOwnMediaEdits?: boolean
  allowChildOwnUsernameEdits?: boolean
  allowChildAudioCalls?: boolean
  allowChildVideoCalls?: boolean
  notifyParentOnMediaChanges?: boolean
  suspended?: boolean
  suspendedAt?: string | null
  suspensionNote?: string | null
  createdAt: string
  updatedAt: string
  age?: number
  modeLabel?: string
}

type FamilyEditorFormState = {
  firstName: string
  lastName: string
  relationship: string
  dateOfBirth: string
  allowChildOwnMediaEdits: boolean
  allowChildOwnUsernameEdits: boolean
  allowChildAudioCalls: boolean
  allowChildVideoCalls: boolean
  notifyParentOnMediaChanges: boolean
}

const FAMILY_RELATIONSHIP_OPTIONS = [
  { value: 'son', label: 'Son' },
  { value: 'daughter', label: 'Daughter' },
  { value: 'child', label: 'Child' },
  { value: 'stepson', label: 'Stepson' },
  { value: 'stepdaughter', label: 'Stepdaughter' },
  { value: 'foster_child', label: 'Foster Child' },
  { value: 'ward', label: 'Ward' },
  { value: 'other', label: 'Other' },
] as const

function getStoredToken() {
  if (typeof window === 'undefined') return null
  const token = window.localStorage.getItem('token')
  return token && token.trim() ? token.trim() : null
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

function getModeLabelFromAge(age: number) {
  if (age <= 8) return 'Early Childhood Mode (5 to 8)'
  if (age <= 12) return 'Junior Mode (9 to 12)'
  if (age <= 15) return 'Teen Mode (13 to 15)'
  if (age <= 17) return 'Youth Mode (16 to 17)'
  return 'Adult Mode (18+)'
}

function getAgeFromDateOfBirth(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const dateOfBirth = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(dateOfBirth.getTime())) return null

  const now = new Date()
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth()
  const dayDelta = now.getUTCDate() - dateOfBirth.getUTCDate()
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1
  }
  return age
}

function createNewFamilyEditorItem(): FamilyEditorItem {
  const nowIso = new Date().toISOString()
  return {
    id: '',
    kind: 'draft',
    firstName: '',
    lastName: '',
    relationship: 'son',
    dateOfBirth: '',
    friendCode: null,
    username: null,
    avatarUrl: null,
    coverUrl: null,
    allowChildOwnMediaEdits: false,
    allowChildOwnUsernameEdits: true,
    allowChildAudioCalls: true,
    allowChildVideoCalls: true,
    notifyParentOnMediaChanges: false,
    suspended: false,
    suspendedAt: null,
    suspensionNote: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

export default function FamilyEditPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editorId = searchParams.get('id')?.trim() ?? ''

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [item, setItem] = useState<FamilyEditorItem | null>(null)
  const [form, setForm] = useState<FamilyEditorFormState>({
    firstName: '',
    lastName: '',
    relationship: 'son',
    dateOfBirth: '',
    allowChildOwnMediaEdits: false,
    allowChildOwnUsernameEdits: true,
    allowChildAudioCalls: true,
    allowChildVideoCalls: true,
    notifyParentOnMediaChanges: false,
  })
  const [mediaUploading, setMediaUploading] = useState<FamilyMediaCategory | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const loadEditor = useCallback(async () => {
    if (!editorId) {
      setItem(createNewFamilyEditorItem())
      setForm({
        firstName: '',
        lastName: '',
        relationship: 'son',
        dateOfBirth: '',
        allowChildOwnMediaEdits: false,
        allowChildOwnUsernameEdits: true,
        allowChildAudioCalls: true,
        allowChildVideoCalls: true,
        notifyParentOnMediaChanges: false,
      })
      setLoading(false)
      return
    }

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    try {
      const response = await fetch(buildApiUrl(`/family/members/editor/${encodeURIComponent(editorId)}`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      const payload = (await response.json().catch(() => null)) as { error?: string; item?: FamilyEditorItem } | null
      if (!response.ok || !payload?.item) {
        if (payload?.error === 'family_mode_not_available') {
          pushToast('Family Mode is not available yet on this server. Apply the Family Mode database migration first.', 'error')
        } else {
          pushToast('Unable to load this family profile editor right now.', 'error')
        }
        router.replace('/settings/family')
        return
      }

      setItem(payload.item)
      setForm({
        firstName: payload.item.firstName,
        lastName: payload.item.lastName,
        relationship: payload.item.relationship,
        dateOfBirth: payload.item.dateOfBirth,
        allowChildOwnMediaEdits: Boolean(payload.item.allowChildOwnMediaEdits),
        allowChildOwnUsernameEdits: payload.item.allowChildOwnUsernameEdits == null ? true : Boolean(payload.item.allowChildOwnUsernameEdits),
        allowChildAudioCalls: payload.item.allowChildAudioCalls == null ? true : Boolean(payload.item.allowChildAudioCalls),
        allowChildVideoCalls: payload.item.allowChildVideoCalls == null ? true : Boolean(payload.item.allowChildVideoCalls),
        notifyParentOnMediaChanges: Boolean(payload.item.notifyParentOnMediaChanges),
      })
    } catch (error) {
      console.error('Failed to load family editor', error)
      pushToast('Unable to load this family profile editor right now.', 'error')
      router.replace('/settings/family')
    } finally {
      setLoading(false)
    }
  }, [editorId, router])

  useEffect(() => {
    void loadEditor()
  }, [loadEditor])

  const canSave =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.relationship.trim().length > 0 &&
    form.dateOfBirth.length === 10 &&
    !saving

  const modePreview = useMemo(() => {
    const age = getAgeFromDateOfBirth(form.dateOfBirth)
    if (age == null || age < 0) return null
    return {
      age,
      modeLabel: getModeLabelFromAge(age),
    }
  }, [form.dateOfBirth])

  const handleSave = useCallback(async () => {
    if (!canSave) return

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSaving(true)
    try {
      const isCreateMode = !editorId
      const response = await fetch(buildApiUrl(isCreateMode ? '/family/members' : `/family/members/editor/${encodeURIComponent(editorId)}`), {
        method: isCreateMode ? 'POST' : 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        if (payload?.error === 'family_mode_not_available') {
          pushToast('Family Mode is not available yet on this server. Apply the Family Mode database migration first.', 'error')
        } else if (payload?.error === 'family_member_limit_reached') {
          pushToast('You can create up to 8 family profiles.', 'error')
        } else if (payload?.error === 'family_member_too_young') {
          pushToast('Family profiles must be at least 5 years old.', 'error')
        } else if (payload?.error === 'family_member_invalid_age' || payload?.error === 'family_member_invalid_dob') {
          pushToast('Enter a valid date of birth for this family member.', 'error')
        } else {
          pushToast('Unable to save this family member right now.', 'error')
        }
        return
      }

      pushToast(isCreateMode || item?.kind === 'draft' ? 'Family member created.' : 'Family member updated.', 'success')
      router.replace('/settings/family')
    } catch (error) {
      console.error('Failed to save family member', error)
      pushToast('Unable to save this family member right now.', 'error')
    } finally {
      setSaving(false)
    }
  }, [canSave, editorId, form, item?.kind, router])

  const handleFamilyMediaChange = useCallback(
    async (category: FamilyMediaCategory, file: File) => {
      if (!item || item.kind !== 'member') {
        pushToast('Save this family member first before updating photos.', 'info')
        return
      }

      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      const validationError = validateFamilyMediaFile(category, file)
      if (validationError) {
        pushToast(validationError, 'error')
        return
      }

      setMediaUploading(category)
      try {
        const assetId = await uploadFamilyMediaAsset({ token, category, file })
        const ready = await waitForFamilyMediaAsset({ token, assetId })
        if (!ready) {
          pushToast(`Your ${getFamilyMediaLabel(category)} is still processing. Please try again in a moment.`, 'warning')
          return
        }

        const payload = await applyFamilyMemberMedia({
          token,
          memberId: item.id,
          category,
          displayAssetId: assetId,
        })

        const nextMember = payload.member as Partial<FamilyEditorItem> | undefined
        if (nextMember) {
          setItem((prev) => (prev ? { ...prev, ...nextMember } : prev))
        }
        pushToast(`${category === 'avatar' ? 'Profile' : 'Cover'} photo updated.`, 'success')
      } catch (error) {
        console.error('Failed to update family member photo', error)
        pushToast(`Unable to update this ${getFamilyMediaLabel(category)} right now.`, 'error')
      } finally {
        setMediaUploading(null)
      }
    },
    [item],
  )

  const handleFilePicked = useCallback(
    (category: FamilyMediaCategory) => async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      await handleFamilyMediaChange(category, file)
    },
    [handleFamilyMediaChange],
  )

  return (
    <DashboardShell rightRail={<RightRail />}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Family Mode</p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-950">
                {item?.kind === 'member' ? 'Edit Family Member' : 'New Family Member'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Complete the supervised family profile here. New profiles stay out of the family list until this editor is saved.
              </p>
            </div>
            <Link href="/settings/family" className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
              Back to Family Mode
            </Link>
          </div>
        </section>

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <HiOutlineArrowPath className="h-5 w-5 animate-spin" />
              Loading family profile editor…
            </div>
          </section>
        ) : null}

        {!loading && item ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_22rem]">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  First name
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-[var(--cc-primary)]"
                    placeholder="First name"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Last name
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-[var(--cc-primary)]"
                    placeholder="Last name"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Relationship
                  <select
                    value={form.relationship}
                    onChange={(event) => setForm((prev) => ({ ...prev, relationship: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--cc-primary)]"
                  >
                    {FAMILY_RELATIONSHIP_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Date of birth
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(event) => setForm((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-[var(--cc-primary)]"
                  />
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.allowChildOwnMediaEdits}
                    onChange={(event) => setForm((prev) => ({ ...prev, allowChildOwnMediaEdits: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                  />
                  <span>This family member can edit their own cover and profile photos</span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.allowChildOwnUsernameEdits}
                    onChange={(event) => setForm((prev) => ({ ...prev, allowChildOwnUsernameEdits: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                  />
                  <span>Child can manage their username</span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.allowChildAudioCalls}
                    onChange={(event) => setForm((prev) => ({ ...prev, allowChildAudioCalls: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                  />
                  <span>Is allowed to audio call</span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.allowChildVideoCalls}
                    onChange={(event) => setForm((prev) => ({ ...prev, allowChildVideoCalls: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                  />
                  <span>Is allowed to video call</span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.notifyParentOnMediaChanges}
                    onChange={(event) => setForm((prev) => ({ ...prev, notifyParentOnMediaChanges: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[var(--cc-primary)] focus:ring-[var(--cc-primary)]"
                  />
                  <span>Notify Me when my child changes their photo and cover</span>
                </label>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!canSave}
                    className={clsx(
                      'inline-flex rounded-full px-4 py-2 text-sm font-semibold text-white transition',
                      canSave ? 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]' : 'cursor-not-allowed bg-slate-300',
                    )}
                  >
                    {saving ? 'Saving…' : item.kind === 'draft' ? 'Create family member' : 'Save changes'}
                  </button>
                  <Link href="/settings/family" className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
                    Cancel
                  </Link>
                </div>
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-900">
                  <HiOutlineUserGroup className="h-5 w-5 text-slate-500" />
                  <h2 className="text-base font-semibold">Profile Photos</h2>
                </div>
                <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                  <div className="h-28 w-full bg-slate-200">
                    <img
                      src={item.coverUrl ?? buildFamilyCoverDataUrl(`${form.firstName} ${form.lastName}`.trim() || 'Family member', modePreview?.age != null && modePreview.age <= 8 ? 'EARLY_CHILDHOOD' : modePreview?.age != null && modePreview.age <= 12 ? 'JUNIOR' : modePreview?.age != null && modePreview.age <= 15 ? 'TEEN' : modePreview?.age != null && modePreview.age <= 17 ? 'YOUTH' : 'ADULT')}
                      alt="Family member cover"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-4">
                    <img
                      src={item.avatarUrl ?? buildFamilyAvatarDataUrl(`${form.firstName} ${form.lastName}`.trim() || 'Family member', modePreview?.age != null && modePreview.age <= 8 ? 'EARLY_CHILDHOOD' : modePreview?.age != null && modePreview.age <= 12 ? 'JUNIOR' : modePreview?.age != null && modePreview.age <= 15 ? 'TEEN' : modePreview?.age != null && modePreview.age <= 17 ? 'YOUTH' : 'ADULT')}
                      alt="Family member avatar"
                      className="h-16 w-16 rounded-2xl border border-white/70 object-cover shadow-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-950">{`${form.firstName} ${form.lastName}`.trim() || 'Family member'}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.kind === 'member'
                          ? 'Parents can update the child avatar and cover here.'
                          : 'Save the family member first to unlock photo uploads.'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleFilePicked('avatar')} />
                  <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleFilePicked('cover')} />
                  <button
                    type="button"
                    disabled={item.kind !== 'member' || mediaUploading !== null}
                    onClick={() => avatarInputRef.current?.click()}
                    className={clsx(
                      'inline-flex rounded-full px-4 py-2 text-sm font-semibold transition',
                      item.kind === 'member' && mediaUploading === null
                        ? 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                        : 'cursor-not-allowed border border-slate-200 text-slate-400',
                    )}
                  >
                    {mediaUploading === 'avatar' ? 'Updating profile photo…' : 'Update profile photo'}
                  </button>
                  <button
                    type="button"
                    disabled={item.kind !== 'member' || mediaUploading !== null}
                    onClick={() => coverInputRef.current?.click()}
                    className={clsx(
                      'inline-flex rounded-full px-4 py-2 text-sm font-semibold transition',
                      item.kind === 'member' && mediaUploading === null
                        ? 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                        : 'cursor-not-allowed border border-slate-200 text-slate-400',
                    )}
                  >
                    {mediaUploading === 'cover' ? 'Updating cover photo…' : 'Update cover photo'}
                  </button>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-900">
                  <HiOutlineUserGroup className="h-5 w-5 text-slate-500" />
                  <h2 className="text-base font-semibold">Editor Status</h2>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {item.kind === 'draft'
                    ? 'This profile is still a draft. It will appear in the supervised family list after you save it.'
                    : 'You are editing an existing supervised family profile.'}
                </p>
                <dl className="mt-4 space-y-3 text-sm text-slate-600">
                  {item.suspended ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="flex items-start gap-2 text-amber-900">
                        <HiOutlineExclamationTriangle className="mt-0.5 h-5 w-5" />
                        <div>
                          <p className="font-semibold">This supervised account is suspended.</p>
                          <p className="mt-1 text-sm text-amber-900/80">{item.suspensionNote ?? 'Your account has been suspended by Family Mode, please ask your parent or guardian to restore your account.'}</p>
                          <p className="mt-1 text-xs text-amber-800/80">Suspended at: {formatTimestamp(item.suspendedAt)}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Created</dt>
                    <dd className="mt-1">{formatTimestamp(item.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last updated</dt>
                    <dd className="mt-1">{formatTimestamp(item.updatedAt)}</dd>
                  </div>
                  {item.friendCode ? (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Friend Code</dt>
                      <dd className="mt-1 font-mono text-slate-700">{item.friendCode}</dd>
                    </div>
                  ) : null}
                  {item.username ? (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Username</dt>
                      <dd className="mt-1 font-mono text-slate-700">{item.username}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-900">
                  <HiOutlineInformationCircle className="h-5 w-5 text-slate-500" />
                  <h2 className="text-base font-semibold">Mode Preview</h2>
                </div>
                {modePreview ? (
                  <div className="mt-4 text-sm text-slate-600">
                    <p className="font-semibold text-slate-950">{modePreview.modeLabel}</p>
                    <p className="mt-1">Age {modePreview.age}</p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">Add a valid date of birth to preview the child&apos;s Family Mode band.</p>
                )}
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}