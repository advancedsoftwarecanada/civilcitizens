'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  HiOutlineArrowPath,
  HiOutlineCheckCircle,
  HiOutlineComputerDesktop,
  HiOutlineExclamationTriangle,
  HiOutlineInformationCircle,
  HiOutlinePencilSquare,
  HiOutlinePlus,
  HiOutlineShieldExclamation,
  HiOutlineTrash,
  HiOutlineUserGroup,
} from 'react-icons/hi2'
import DashboardShell from '../../_components/DashboardShell'
import Modal from '../../_components/Modal'
import { RightRail } from '../../_components/RightRail'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { setFamilyLockedAuthSession } from '../../_lib/authSession'
import { activateFamilyView } from '../../_lib/familyView'

type FamilyEligibility = {
  firstName: boolean
  lastName: boolean
  dateOfBirth: boolean
  countryOfBirth: boolean
  complete: boolean
}

type FamilyModeState = {
  enabled: boolean
  enabledAt: string | null
  affirmedProfileTruthAt: string | null
  acceptedChildSafetyInfoAt: string | null
}

type FamilyDraft = {
  id: string
  createdAt: string
  updatedAt: string
}

type FamilyMember = {
  id: string
  firstName: string
  lastName: string
  relationship: string
  relationshipLabel: string
  displayName: string
  dateOfBirth: string
  age: number
  modeBand: string
  modeLabel: string
  friendCode: string
  suspended: boolean
  suspendedAt: string | null
  suspendedById: string | null
  suspensionNote: string | null
  createdAt: string
  updatedAt: string
}

type FamilyResponse = {
  profileEligibility: FamilyEligibility
  familyMode: FamilyModeState
  limits: { maxMembers: number }
  childSafetyInfoUrl: string
  pendingDraft: FamilyDraft | null
  members: FamilyMember[]
}

function getStoredToken() {
  if (typeof window === 'undefined') return null
  const token = window.localStorage.getItem('token')
  return token && token.trim() ? token.trim() : null
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Not yet enabled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet enabled'
  return date.toLocaleString()
}

export default function FamilySettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [familyData, setFamilyData] = useState<FamilyResponse | null>(null)
  const [profileTruthConfirmed, setProfileTruthConfirmed] = useState(false)
  const [childSafetyAccepted, setChildSafetyAccepted] = useState(false)
  const [memberDeletingId, setMemberDeletingId] = useState<string | null>(null)
  const [memberSuspendingId, setMemberSuspendingId] = useState<string | null>(null)
  const [memberRestoringId, setMemberRestoringId] = useState<string | null>(null)
  const [memberLockingId, setMemberLockingId] = useState<string | null>(null)
  const [childSafetyModalOpen, setChildSafetyModalOpen] = useState(false)
  const [deleteModalMember, setDeleteModalMember] = useState<FamilyMember | null>(null)
  const [lockModalMember, setLockModalMember] = useState<FamilyMember | null>(null)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')

  const loadFamilyData = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    try {
      const response = await fetch(buildApiUrl('/family'), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      const payload = (await response.json().catch(() => null)) as { error?: string } & Partial<FamilyResponse> | null
      if (!response.ok || !payload) {
        if (payload?.error === 'family_mode_not_available') {
          pushToast('Family Mode is not available yet on this server. Apply the Family Mode database migration first.', 'error')
        } else {
          pushToast('Unable to load Family Mode right now.', 'error')
        }
        return
      }

      setFamilyData(payload as FamilyResponse)
    } catch (error) {
      console.error('Failed to load family settings', error)
      pushToast('Unable to load Family Mode right now.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFamilyData()
  }, [loadFamilyData])

  const missingRequirements = useMemo(() => {
    if (!familyData) return []
    const items: string[] = []
    if (!familyData.profileEligibility.firstName) items.push('First name')
    if (!familyData.profileEligibility.lastName) items.push('Last name')
    if (!familyData.profileEligibility.dateOfBirth) items.push('Date of birth')
    if (!familyData.profileEligibility.countryOfBirth) items.push('Country of birth')
    return items
  }, [familyData])

  const memberLimitReached = Boolean(familyData && familyData.members.length >= familyData.limits.maxMembers)
  const canEnableFamilyMode = profileTruthConfirmed && childSafetyAccepted && !saving
  const canLaunchEditor = Boolean(familyData?.familyMode.enabled) && !memberLimitReached

  const handleEnableFamilyMode = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(buildApiUrl('/family'), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          affirmedProfileTruth: true,
          acceptedChildSafetyInfo: true,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        if (payload?.error === 'family_profile_incomplete') {
          pushToast('Complete your profile before enabling Family Mode.', 'error')
        } else {
          pushToast('Unable to enable Family Mode right now.', 'error')
        }
        return
      }

      pushToast('Family Mode enabled.', 'success')
      setProfileTruthConfirmed(false)
      setChildSafetyAccepted(false)
      await loadFamilyData()
    } catch (error) {
      console.error('Failed to enable family mode', error)
      pushToast('Unable to enable Family Mode right now.', 'error')
    } finally {
      setSaving(false)
    }
  }, [loadFamilyData])

  const handleDeleteMember = useCallback(
    async (member: FamilyMember) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setMemberDeletingId(member.id)
      try {
        const response = await fetch(buildApiUrl(`/family/members/${member.id}`), {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            confirmationName: deleteConfirmationName,
          }),
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null
          if (payload?.error === 'family_member_confirmation_mismatch') {
            pushToast(`Type ${member.displayName} exactly to confirm deletion.`, 'error')
          } else {
            pushToast('Unable to remove this family member right now.', 'error')
          }
          return
        }

        pushToast('Family member removed.', 'success')
        setDeleteModalMember(null)
        setDeleteConfirmationName('')
        await loadFamilyData()
      } catch (error) {
        console.error('Failed to delete family member', error)
        pushToast('Unable to remove this family member right now.', 'error')
      } finally {
        setMemberDeletingId(null)
      }
    },
    [deleteConfirmationName, loadFamilyData],
  )

  const handleSuspendMember = useCallback(
    async (member: FamilyMember) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setMemberSuspendingId(member.id)
      try {
        const response = await fetch(buildApiUrl(`/family/members/${member.id}/suspend`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          pushToast('Unable to suspend this family member right now.', 'error')
          return
        }

        pushToast('Family member suspended until the parent restores access.', 'success')
        await loadFamilyData()
      } catch (error) {
        console.error('Failed to suspend family member', error)
        pushToast('Unable to suspend this family member right now.', 'error')
      } finally {
        setMemberSuspendingId(null)
      }
    },
    [loadFamilyData],
  )

  const handleRestoreMember = useCallback(
    async (member: FamilyMember) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setMemberRestoringId(member.id)
      try {
        const response = await fetch(buildApiUrl(`/family/members/${member.id}/restore`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          pushToast('Unable to restore this family member right now.', 'error')
          return
        }

        pushToast('Family member restored.', 'success')
        await loadFamilyData()
      } catch (error) {
        console.error('Failed to restore family member', error)
        pushToast('Unable to restore this family member right now.', 'error')
      } finally {
        setMemberRestoringId(null)
      }
    },
    [loadFamilyData],
  )

  const handleLockDevice = useCallback(
    async (member: FamilyMember) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setMemberLockingId(member.id)
      try {
        const response = await fetch(buildApiUrl(`/family/members/${member.id}/lock-device-session`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })

        if (response.status === 401) {
          redirectToAuthModal('login')
          return
        }

        const payload = (await response.json().catch(() => null)) as { error?: string; token?: string } | null
        if (!response.ok || !payload?.token) {
          if (payload?.error === 'family_mode_not_available') {
            pushToast('Family Mode is not available yet on this server. Apply the Family Mode database migration first.', 'error')
          } else {
            pushToast('Unable to lock this device to the family account right now.', 'error')
          }
          return
        }

        activateFamilyView({
          memberId: member.id,
          displayName: member.displayName,
          modeBand: member.modeBand as 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT',
          modeLabel: member.modeLabel,
          age: member.age,
          relationshipLabel: member.relationshipLabel,
          suspended: member.suspended,
          suspendedAt: member.suspendedAt,
          suspensionNote: member.suspensionNote,
        })
        setFamilyLockedAuthSession({ childToken: payload.token, parentToken: token })
        setLockModalMember(null)
        router.replace(member.suspended ? '/suspended' : '/home')
      } catch (error) {
        console.error('Failed to lock device to family member', error)
        pushToast('Unable to lock this device to the family account right now.', 'error')
      } finally {
        setMemberLockingId(null)
      }
    },
    [router],
  )

  return (
    <DashboardShell rightRail={<RightRail />}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Settings</p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-950">Family Mode</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Family Mode lets a parent create supervised profiles for children under the parent account. New profiles now
                start in a dedicated draft editor before they appear in the supervised family list.
              </p>
            </div>
            <Link href="/settings" className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
              Back to settings
            </Link>
          </div>
        </section>

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <HiOutlineArrowPath className="h-5 w-5 animate-spin" />
              Loading Family Mode…
            </div>
          </section>
        ) : null}

        {!loading && familyData && !familyData.profileEligibility.complete ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <HiOutlineExclamationTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-amber-950">Complete your profile first</h2>
                <p className="mt-2 text-sm leading-6 text-amber-900/80">
                  Family Mode requires a real parent identity on file. Please complete the missing profile details below in
                  your profile editor before enabling Family Mode.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {missingRequirements.map((item) => (
                    <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-700 shadow-sm">
                      {item}
                    </span>
                  ))}
                </div>
                <div className="mt-5">
                  <Link href="/profile/edit" className="inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]">
                    Complete profile
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {!loading && familyData && familyData.profileEligibility.complete ? (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <HiOutlineInformationCircle className="mt-0.5 h-5 w-5 text-slate-500" />
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Parent attestation</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Before Family Mode can be enabled, the parent must attest that their identity details are true and that
                      they understand Civil&apos;s child safety requirements.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">Family Mode status</p>
                    <p className="mt-1">{familyData.familyMode.enabled ? 'Enabled' : 'Not enabled yet'}</p>
                    <p className="mt-1 text-xs text-slate-500">Enabled at: {formatTimestamp(familyData.familyMode.enabledAt)}</p>
                  </div>

                  {!familyData.familyMode.enabled ? (
                    <>
                      <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={profileTruthConfirmed}
                          onChange={(event) => setProfileTruthConfirmed(event.target.checked)}
                        />
                        <span>I attest that my first name, last name, date of birth, and country of birth are true and belong to me.</span>
                      </label>

                      <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={childSafetyAccepted}
                          onChange={(event) => setChildSafetyAccepted(event.target.checked)}
                        />
                        <span>
                          I understand that Family Mode is for parent-supervised child accounts and I have reviewed Civil&apos;s child safety guidance.
                        </span>
                      </label>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleEnableFamilyMode()}
                          disabled={!canEnableFamilyMode}
                          className={clsx(
                            'inline-flex rounded-full px-4 py-2 text-sm font-semibold text-white transition',
                            canEnableFamilyMode ? 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]' : 'cursor-not-allowed bg-slate-300',
                          )}
                        >
                          {saving ? 'Enabling…' : 'Enable Family Mode'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChildSafetyModalOpen(true)}
                          className="text-sm font-semibold text-[var(--cc-primary)] hover:underline"
                        >
                          Read child safety information
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                      <HiOutlineCheckCircle className="h-5 w-5" />
                      Family Mode is enabled for this parent account.
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Supervised family profiles</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">Create up to {familyData.limits.maxMembers} supervised family members.</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {familyData.members.length} / {familyData.limits.maxMembers}
                  </div>
                  {canLaunchEditor ? (
                    <Link
                      href="/settings/family/edit"
                      className="inline-flex items-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
                    >
                      <HiOutlinePlus className="h-5 w-5" />
                      Add
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-slate-300 px-4 py-2 text-sm font-semibold text-white"
                    >
                      <HiOutlinePlus className="h-5 w-5" />
                      Add
                    </button>
                  )}
                </div>
              </div>

              {!familyData.familyMode.enabled ? (
                <p className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Enable Family Mode above before creating supervised profiles.
                </p>
              ) : null}

              <div className="mt-6 space-y-4">
                {familyData.members.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-500">
                    No family members yet.
                  </div>
                ) : null}

                {familyData.members.map((member) => (
                  <article key={member.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <HiOutlineUserGroup className="h-5 w-5 text-slate-500" />
                          <h3 className="text-base font-semibold text-slate-950">{member.displayName}</h3>
                          {member.suspended ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                              Suspended
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{member.modeLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">{member.relationshipLabel} • Age {member.age} • DOB {member.dateOfBirth}</p>
                        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Friend Code</p>
                        <p className="mt-1 font-mono text-sm text-slate-700">{member.friendCode}</p>
                        {member.suspended ? (
                          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
                            <p className="font-semibold">This supervised account is suspended.</p>
                            <p className="mt-1">{member.suspensionNote ?? 'Your account has been suspended by Family Mode, please ask your parent or guardian to restore your account.'}</p>
                            <p className="mt-1 text-amber-800/80">Suspended at: {formatTimestamp(member.suspendedAt)}</p>
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</p>
                        <div className="mt-3 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => setLockModalMember(member)}
                            disabled={memberLockingId === member.id}
                            className="inline-flex w-full items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <HiOutlineComputerDesktop className="h-4 w-4" />
                            {memberLockingId === member.id ? 'Locking device…' : 'Lock To This Device'}
                          </button>

                          <button
                            type="button"
                            onClick={() => router.push(`/settings/family/edit?id=${encodeURIComponent(member.id)}`)}
                            className="inline-flex w-full items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <HiOutlinePencilSquare className="h-4 w-4" />
                            Edit
                          </button>

                          {member.suspended ? (
                            <button
                              type="button"
                              onClick={() => void handleRestoreMember(member)}
                              disabled={memberRestoringId === member.id}
                              className="inline-flex w-full items-center gap-2 rounded-2xl border border-emerald-200 px-3 py-2 text-left text-sm font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <HiOutlineShieldExclamation className="h-4 w-4" />
                              {memberRestoringId === member.id ? 'Restoring…' : 'Restore'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSuspendMember(member)}
                              disabled={memberSuspendingId === member.id}
                              className="inline-flex w-full items-center gap-2 rounded-2xl border border-amber-200 px-3 py-2 text-left text-sm font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
                            >
                              <HiOutlineShieldExclamation className="h-4 w-4" />
                              {memberSuspendingId === member.id ? 'Suspending…' : 'Suspend'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setDeleteModalMember(member)
                              setDeleteConfirmationName('')
                            }}
                            disabled={memberDeletingId === member.id}
                            className="inline-flex w-full items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-left text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <HiOutlineTrash className="h-4 w-4" />
                            {memberDeletingId === member.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>

      <Modal
        open={Boolean(deleteModalMember)}
        onClose={() => {
          if (memberDeletingId) return
          setDeleteModalMember(null)
          setDeleteConfirmationName('')
        }}
        title="Delete Family Member"
        maxWidthClassName="max-w-xl"
      >
        <div className="space-y-5 text-sm leading-6 text-slate-700">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900">
            <p className="font-semibold">This permanently deletes the supervised family profile and all Family Mode activity tied to it.</p>
            <p className="mt-1">This action cannot be undone.</p>
          </div>

          {deleteModalMember ? (
            <p>
              To confirm deletion, type <span className="font-semibold text-slate-950">{deleteModalMember.displayName}</span> exactly.
            </p>
          ) : null}

          <label className="block text-sm font-medium text-slate-700">
            Child name confirmation
            <input
              type="text"
              value={deleteConfirmationName}
              onChange={(event) => setDeleteConfirmationName(event.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-rose-400"
              placeholder={deleteModalMember?.displayName ?? 'Type full name'}
            />
          </label>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setDeleteModalMember(null)
                setDeleteConfirmationName('')
              }}
              disabled={Boolean(memberDeletingId)}
              className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteModalMember && void handleDeleteMember(deleteModalMember)}
              disabled={!deleteModalMember || deleteConfirmationName.trim().toLowerCase() !== deleteModalMember.displayName.trim().toLowerCase() || Boolean(memberDeletingId)}
              className={clsx(
                'inline-flex rounded-full px-4 py-2 text-sm font-semibold text-white transition',
                deleteModalMember && deleteConfirmationName.trim().toLowerCase() === deleteModalMember.displayName.trim().toLowerCase() && !memberDeletingId
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'cursor-not-allowed bg-slate-300',
              )}
            >
              {memberDeletingId ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(lockModalMember)}
        onClose={() => {
          if (memberLockingId) return
          setLockModalMember(null)
        }}
        title="Lock This Device"
        maxWidthClassName="max-w-xl"
      >
        <div className="space-y-5 text-sm leading-6 text-slate-700">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <p className="font-semibold">This signs out the current parent account on this device and signs into the supervised family account.</p>
            <p className="mt-1">Use this when the device is being handed over to the child.</p>
          </div>

          {lockModalMember ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p>
                The device will lock into <span className="font-semibold text-slate-950">{lockModalMember.displayName}</span>.
              </p>
              <p className="mt-2 text-slate-600">
                After that, the child will see their supervised shell. The parent session can be restored later from Family locked-device settings.
              </p>
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setLockModalMember(null)}
              disabled={Boolean(memberLockingId)}
              className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!lockModalMember) return
                void handleLockDevice(lockModalMember)
              }}
              disabled={!lockModalMember || Boolean(memberLockingId)}
              className="inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:opacity-50"
            >
              {memberLockingId ? 'Yes, locking…' : 'Yes'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={childSafetyModalOpen}
        onClose={() => setChildSafetyModalOpen(false)}
        title="Child Safety Information"
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-5 text-sm leading-6 text-slate-700">
          <p>
            Family Mode is intended for parent-supervised use. It is designed for situations where a parent or guardian is
            actively responsible for the child account, the device it is used on, and the approval of the child&apos;s social activity.
          </p>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-slate-950">Parent responsibilities</h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>Use your real legal identity details on your Civil parent account.</li>
              <li>Do not enable Family Mode for children you do not supervise directly.</li>
              <li>Review friend connections, chats, profile media, and posted content before approval.</li>
              <li>Lock shared devices carefully and sign children out immediately if supervision changes.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-slate-950">What Family Mode is for</h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>Supervised messaging and social participation under a parent account.</li>
              <li>Parental review of child posts, friend requests, and profile-media changes.</li>
              <li>Clear separation between the parent account and a child-facing device experience.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-slate-950">Not a replacement for supervision</h3>
            <p>
              Family Mode does not replace direct parental oversight. Parents remain responsible for account security, device access,
              and deciding when a child is ready to use Civil features.
            </p>
          </section>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
            This guidance will expand as Family Mode approval flows, remote device controls, and child-specific safeguards are added.
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setChildSafetyModalOpen(false)}
              className="inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}