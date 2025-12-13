'use client'

import { useState, useCallback } from 'react'
import Modal from './Modal'
import { ApiPost, CommunityTarget } from './PostComposer'
import { buildApiUrl } from '../_lib/api'
import { getStoredToken } from '../_lib/tokenStorage'
import { pushToast } from './useToasts'
import VerifiedAvatar from './VerifiedAvatar'
import { formatDisplayName } from '../_lib/text'

type SharePostModalProps = {
  post: ApiPost
  onClose: () => void
  onShare?: (newPost: ApiPost) => void
  communityOptions?: CommunityTarget[]
}

export default function SharePostModal({ post, onClose, onShare, communityOptions = [] }: SharePostModalProps) {
  const [commentary, setCommentary] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [audience, setAudience] = useState('friends') // 'friends' or 'community:PROV:SLUG'

  const canSubmit = commentary.trim().length > 0 && !submitting

  const handleShare = async () => {
    if (!canSubmit) return

    setSubmitting(true)
    try {
      const token = getStoredToken()
      if (!token) return

      const payload: any = {
        type: 'post',
        body: commentary,
        sharedPostId: post.id,
        jurisdiction: 'self',
      }

      if (audience.startsWith('community:')) {
        const [_, province, slug] = audience.split(':')
        payload.communityProvince = province
        payload.communitySlug = slug
        payload.jurisdiction = 'municipal' // Default for community posts
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
        throw new Error('Failed to share post')
      }

      const newPost = await res.json()
      pushToast('Post shared successfully', 'success')
      onShare?.(newPost)
      onClose()
    } catch (err) {
      console.error(err)
      pushToast('Failed to share post', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const authorName = formatDisplayName(post.author.name) || post.author.handle

  return (
    <Modal open onClose={onClose} title="Share with a note" maxWidthClassName="max-w-xl">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Audience
          </label>
          <select
            className="w-full rounded-lg border-slate-200 text-sm font-medium text-slate-700 focus:border-[var(--cc-primary)] focus:ring-0"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            disabled={submitting}
          >
            <option value="friends">Friends</option>
            {communityOptions.map((opt) => (
              <option key={`${opt.provinceCode}:${opt.communitySlug}`} value={`community:${opt.provinceCode}:${opt.communitySlug}`}>
                {opt.communityName || opt.communitySlug}
              </option>
            ))}
          </select>
        </div>

        <div>
          <textarea
            className="w-full rounded-xl border-slate-200 bg-slate-50 p-4 text-base focus:bg-white focus:border-[var(--cc-primary)] focus:ring-0"
            placeholder="Why are you sharing this?"
            rows={3}
            value={commentary}
            onChange={(e) => setCommentary(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 opacity-75 pointer-events-none select-none">
          <div className="flex items-center gap-2 mb-2">
            <VerifiedAvatar
              src={post.author.avatarUrl}
              alt={authorName}
              initials={authorName}
              size={24}
              isVerified={post.author.isVerified}
              isBusiness={post.author.isPremium}
            />
            <span className="text-sm font-semibold text-slate-900">{authorName}</span>
            <span className="text-xs text-slate-500">• {new Date(post.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="text-sm text-slate-800 line-clamp-3">
            {post.body || (post.title ? post.title : 'Media post')}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-semibold text-white bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Sharing...' : 'Share Post'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
