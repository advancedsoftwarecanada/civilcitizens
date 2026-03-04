'use client'

import { useMemo, useState } from 'react'
import Modal from './Modal'
import { type ApiPost, type CommunityTarget } from './PostComposer'
import { buildApiUrl } from '../_lib/api'
import { buildRepostBody, isPostTarget, toAbsoluteShareUrl, type ShareTarget } from '../_lib/shareTarget'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'

type SharePostModalProps = {
  target: ShareTarget
  onClose: () => void
  onShare?: (newPost: ApiPost) => void
  communityOptions?: CommunityTarget[]
}

function buildCommunityValue(target: CommunityTarget): string {
  return `${target.provinceCode}:${target.communitySlug}`
}

function parseCommunityValue(value: string): { provinceCode: string; communitySlug: string } | null {
  const [provinceCode, communitySlug] = value.split(':')
  if (!provinceCode || !communitySlug) return null
  return { provinceCode, communitySlug }
}

export default function SharePostModal({ target, onClose, onShare, communityOptions = [] }: SharePostModalProps) {
  const [commentary, setCommentary] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [audience, setAudience] = useState<'friends' | 'network' | 'community'>('friends')
  const [communityValue, setCommunityValue] = useState(() => (communityOptions[0] ? buildCommunityValue(communityOptions[0]) : ''))

  const selectedCommunity = useMemo(() => parseCommunityValue(communityValue), [communityValue])
  const requiresCommunity = audience === 'community'
  const canSubmit = !submitting && (!requiresCommunity || Boolean(selectedCommunity))
  const canUseNativeRepost = isPostTarget(target)

  const handleShare = async () => {
    if (!canSubmit) return

    setSubmitting(true)
    try {
      const token = getStoredToken()
      if (!token) return

      const payload: Record<string, unknown> = {
        type: 'post',
        body: canUseNativeRepost ? commentary.trim() : buildRepostBody(target, commentary),
        jurisdiction: 'self',
        audience: requiresCommunity ? 'community' : audience,
      }

      if (canUseNativeRepost) {
        payload.sharedPostId = target.post.id
      }

      if (requiresCommunity) {
        if (!selectedCommunity) {
          pushToast('Select a community before reposting.', 'error')
          return
        }
        payload.communityProvince = selectedCommunity.provinceCode
        payload.communitySlug = selectedCommunity.communitySlug
        payload.jurisdiction = 'municipal'
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
        throw new Error('repost_failed')
      }

      const newPost = (await res.json().catch(() => null)) as ApiPost | null
      if (newPost) onShare?.(newPost)
      pushToast('Reposted successfully', 'success')
      onClose()
    } catch (err) {
      console.error(err)
      pushToast('Failed to repost right now', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Repost" maxWidthClassName="max-w-xl">
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 opacity-80">
          <div className="flex items-start gap-3">
            {target.imageUrl ? (
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                <img src={target.imageUrl} alt={target.title} className="h-full w-full object-cover" loading="lazy" />
              </div>
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-slate-900">{target.title}</p>
              {target.description ? <p className="line-clamp-3 text-sm text-slate-700">{target.description}</p> : null}
              <p className="truncate text-xs text-slate-500">{toAbsoluteShareUrl(target.url)}</p>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Audience
          </label>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none"
            value={audience}
            onChange={(event) => setAudience(event.target.value as 'friends' | 'network' | 'community')}
            disabled={submitting}
          >
            <option value="friends">Friends</option>
            <option value="network">Network</option>
            <option value="community">Community</option>
          </select>
        </div>

        {requiresCommunity ? (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Select Community
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              value={communityValue}
              onChange={(event) => setCommunityValue(event.target.value)}
              disabled={submitting || communityOptions.length === 0}
            >
              {communityOptions.length === 0 ? <option value="">No communities available</option> : null}
              {communityOptions.map((option) => (
                <option key={`${option.provinceCode}:${option.communitySlug}`} value={buildCommunityValue(option)}>
                  {option.communityName || option.communitySlug}
                </option>
              ))}
            </select>
            {communityOptions.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">Follow a community first to repost there.</p>
            ) : null}
          </div>
        ) : null}

        <div>
          <textarea
            className="w-full rounded-xl border-slate-200 bg-slate-50 p-4 text-base focus:border-[var(--cc-primary)] focus:bg-white focus:ring-0"
            placeholder="Add a note (optional)"
            rows={2}
            value={commentary}
            onChange={(event) => setCommentary(event.target.value)}
            disabled={submitting}
            autoFocus
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Reposting...' : 'Repost'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
