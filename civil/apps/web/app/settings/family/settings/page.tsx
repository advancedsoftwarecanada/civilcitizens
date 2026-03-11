'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  HiOutlineArrowLeftCircle,
  HiOutlineCog6Tooth,
  HiOutlineComputerDesktop,
  HiOutlineShieldExclamation,
} from 'react-icons/hi2'
import DashboardShell from '../../../_components/DashboardShell'
import Modal from '../../../_components/Modal'
import { RightRail } from '../../../_components/RightRail'
import { pushToast } from '../../../_components/useToasts'
import { clearAuthSession } from '../../../_lib/authSession'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { clearFamilyView } from '../../../_lib/familyView'
import { buildFamilyAvatarDataUrl, buildFamilyCoverDataUrl } from '../../../_lib/familyIdentity'
import { applyFamilyMemberMedia, getFamilyMediaLabel, uploadFamilyMediaAsset, validateFamilyMediaFile, waitForFamilyMediaAsset, type FamilyMediaCategory } from '../../../_lib/familyMedia'
import { useViewerStore } from '../../../_lib/viewerStore'

export default function FamilyLockedSettingsPage() {
  const router = useRouter()
  const familyView = useViewerStore((s) => s.familyView)
  const viewer = useViewerStore((s) => s.me)
  const setViewer = useViewerStore((s) => s.setMe)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [mediaUpdating, setMediaUpdating] = useState<FamilyMediaCategory | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!familyView) {
      router.replace('/settings/family')
    }
  }, [familyView, router])

  const handleFamilyMediaChange = useCallback(
    async (category: FamilyMediaCategory, file: File) => {
      if (!familyView || !viewer?.familyMemberSession?.allowChildOwnMediaEdits) {
        pushToast('Photo updates are disabled for this child account.', 'error')
        return
      }

      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token')?.trim() || null : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      const validationError = validateFamilyMediaFile(category, file)
      if (validationError) {
        pushToast(validationError, 'error')
        return
      }

      setMediaUpdating(category)
      try {
        const assetId = await uploadFamilyMediaAsset({ token, category, file })
        const ready = await waitForFamilyMediaAsset({ token, assetId })
        if (!ready) {
          pushToast(`Your ${getFamilyMediaLabel(category)} is still processing. Please try again in a moment.`, 'warning')
          return
        }

        const payload = await applyFamilyMemberMedia({
          token,
          memberId: viewer.id,
          category,
          displayAssetId: assetId,
        })

        if (payload.viewer) {
          setViewer(payload.viewer as typeof viewer)
        }
        pushToast(`${category === 'avatar' ? 'Profile' : 'Cover'} photo updated.`, 'success')
      } catch (error) {
        console.error('Failed to update child media', error)
        pushToast(`Unable to update your ${getFamilyMediaLabel(category)} right now.`, 'error')
      } finally {
        setMediaUpdating(null)
      }
    },
    [familyView, setViewer, viewer],
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

  if (!familyView) return null

  return (
    <DashboardShell rightRail={<RightRail />}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Family Mode</p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-950">Locked Device Settings</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                This device is currently locked to {familyView.displayName}. Use these controls to return to the parent account or review the supervised session.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_22rem]">
          <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-slate-900">
              <HiOutlineComputerDesktop className="h-5 w-5 text-slate-500" />
              <h2 className="text-base font-semibold">Locked Device Session</h2>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
              <p><span className="font-semibold text-slate-950">Child:</span> {familyView.displayName}</p>
              <p className="mt-1"><span className="font-semibold text-slate-950">Mode:</span> {familyView.modeLabel}</p>
              <p className="mt-1"><span className="font-semibold text-slate-950">Relationship:</span> {familyView.relationshipLabel}</p>
              <p className="mt-1"><span className="font-semibold text-slate-950">Age:</span> {familyView.age}</p>
              {viewer?.familyMemberSession?.parentHandle ? (
                <p className="mt-1"><span className="font-semibold text-slate-950">Parent:</span> @{viewer.familyMemberSession.parentHandle}</p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="h-28 w-full bg-slate-200">
                  <img
                    src={viewer?.coverUrl ?? buildFamilyCoverDataUrl(familyView.displayName, familyView.modeBand)}
                    alt="Child cover"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex items-center gap-3 px-4 py-4">
                  <img
                    src={viewer?.avatarUrl ?? buildFamilyAvatarDataUrl(familyView.displayName, familyView.modeBand)}
                    alt="Child profile"
                    className="h-16 w-16 rounded-2xl border border-white/70 object-cover shadow-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950">Profile and cover photos</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {viewer?.familyMemberSession?.allowChildOwnMediaEdits
                        ? viewer.familyMemberSession.notifyParentOnMediaChanges
                          ? 'You can update your photos here. Your parent or guardian will be notified when you make a change.'
                          : 'You can update your photos here.'
                        : 'Your parent or guardian controls these photo settings.'}
                    </p>
                  </div>
                </div>
              </div>

              {viewer?.familyMemberSession?.allowChildOwnMediaEdits ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleFilePicked('avatar')} />
                  <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleFilePicked('cover')} />
                  <button
                    type="button"
                    disabled={mediaUpdating !== null}
                    onClick={() => avatarInputRef.current?.click()}
                    className={mediaUpdating === null ? 'inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900' : 'inline-flex cursor-not-allowed rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-400'}
                  >
                    {mediaUpdating === 'avatar' ? 'Updating profile photo…' : 'Update profile photo'}
                  </button>
                  <button
                    type="button"
                    disabled={mediaUpdating !== null}
                    onClick={() => coverInputRef.current?.click()}
                    className={mediaUpdating === null ? 'inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900' : 'inline-flex cursor-not-allowed rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-400'}
                  >
                    {mediaUpdating === 'cover' ? 'Updating cover photo…' : 'Update cover photo'}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(true)}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
              >
                <HiOutlineArrowLeftCircle className="h-4 w-4" />
                Exit locked device
              </button>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <HiOutlineCog6Tooth className="h-5 w-5 text-slate-500" />
                <h2 className="text-base font-semibold">What This Does</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                A locked device signs the parent out on this hardware and keeps the child account active until the parent restores access.
              </p>
            </section>

            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-amber-900">
                <HiOutlineShieldExclamation className="h-5 w-5" />
                <h2 className="text-base font-semibold">Parent Reminder</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-amber-900/80">
                Restore the parent session before using any parent-only tools or settings on this device.
              </p>
            </section>
          </aside>
        </section>
      </div>

      <Modal open={logoutConfirmOpen} onClose={() => setLogoutConfirmOpen(false)} title="Log out of locked device?">
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">
            Your Parent or Guardian will have to log you in again.
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(false)}
              className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                clearAuthSession()
                clearFamilyView()
                if (typeof window !== 'undefined') {
                  window.sessionStorage.clear()
                  window.localStorage.clear()
                  window.location.assign('/')
                  return
                }
                router.replace('/')
              }}
              className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
            >
              Yes, logout
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}
