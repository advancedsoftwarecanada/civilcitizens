"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LuMessageCircle, LuRepeat2, LuShare } from 'react-icons/lu'
import { HiTrash } from 'react-icons/hi2'
import type { ReactionType } from '@civil/shared'
import CivilCard from '../../../../../_components/CivilCard'
import PostAuthorMiniCard from '../../../../../_components/PostAuthorMiniCard'
import ContentModerationMenu from '../../../../../_components/ContentModerationMenu'
import { JURISDICTION_LABELS, type ApiPost } from '../../../../../_components/PostComposer'
import CommentComposer from '../../../../../_components/CommentComposer'
import CommentThread, { type ApiComment } from '../../../../../_components/CommentThread'
import CivilLinkPreviewList from '../../../../../_components/CivilLinkPreviewList'
import PostReactionBar from '../../../../../_components/PostReactionBar'
import PollCard from '../../../../../_components/PollCard'
import ThreadBottomCommentComposer from '../../../../../_components/ThreadBottomCommentComposer'
import SharePostModal from '../../../../../_components/SharePostModal'
import ShareSendModal from '../../../../../_components/ShareSendModal'
import { pushToast } from '../../../../../_components/useToasts'
import { hasHomeCommunity } from '../../../../../_lib/me'
import { redirectToAuthModal } from '../../../../../_lib/authModal'
import { buildPostShareTarget } from '../../../../../_lib/shareTarget'
import { stripCivilUrlsFromHtml, stripCivilUrlsFromText } from '../../../../../_lib/civilLinks'
import { ensureViewerMe } from '../../../../../_lib/viewerMe'
import { useViewerStore } from '../../../../../_lib/viewerStore'
import { addCommentToTree, normalizeCommentTree, removeCommentFromTree, removeCommentsByAuthorFromTree, updateCommentInTree } from '../../../../../_lib/comments'
import { formatUserDisplayName } from '../../../../../_lib/text'
import { buildApiUrl } from '../../../../../_lib/api'
import { getStoredToken } from '../../../../../_lib/tokenStorage'
import DashboardShell from '../../../../../_components/DashboardShell'
import { useRegisterPageView } from '../../../../../_components/AnalyticsTracker'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
}

type CanonicalPaths = {
  user: string
  community: string | null
  legacy: string
}

type PageProps = {
  params: {
    province: string
    chamber: string
    slug: string
  }
}

type CommunityOrgItem = {
  id: string
  name: string
  slug: string
  provinceCode: string | null
  communitySlug: string | null
  isVerified: boolean
  logoUrl?: string | null
  coverUrl?: string | null
}

const COMMENT_SORT_OPTIONS: Array<{ value: 'hot' | 'new'; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
]

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function ChamberPostPage({ params }: PageProps) {
  const router = useRouter()
  const provinceParam = decodeURIComponent(params.province)
  const chamberParam = decodeURIComponent(params.chamber)
  const slugParam = decodeURIComponent(params.slug)

  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [post, setPost] = useState<ApiPost | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'not-found'>('loading')
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentSort, setCommentSort] = useState<'hot' | 'new'>('hot')
  const [appliedCommentSort, setAppliedCommentSort] = useState<'hot' | 'new'>('hot')
  const [pendingVote, setPendingVote] = useState(false)
  const [repostModalOpen, setRepostModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [railPosts, setRailPosts] = useState<ApiPost[]>([])
  const [railOrganizations, setRailOrganizations] = useState<CommunityOrgItem[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/c/')) {
      const target = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}/posts/${slugParam}`
      router.replace(target)
    }
  }, [chamberParam, provinceParam, router, slugParam])

  const loadViewer = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    try {
      const cached = useViewerStore.getState().me
      if (cached) {
        if (!hasHomeCommunity(cached)) {
          router.replace('/welcome')
          return
        }
        setViewer(cached)
        return
      }

      const data = await ensureViewerMe({ token })
      if (!data) {
        redirectToAuthModal('login')
        return
      }
      if (!hasHomeCommunity(data)) {
        router.replace('/welcome')
        return
      }
      setViewer(data)
    } catch {
      redirectToAuthModal('login')
      /* noop */
    }
  }, [router])

  const loadPost = useCallback(async (sortMode: 'hot' | 'new') => {
    setStatus('loading')
    setComments([])
    try {
      const slugRes = await fetch(`/api/posts/slug/${encodeURIComponent(slugParam)}?commentSort=${sortMode}`)

      let data: any = null
      if (slugRes.ok) {
        data = await slugRes.json()
      } else if (slugRes.status === 404) {
        const idRes = await fetch(`/api/posts/${encodeURIComponent(slugParam)}`)
        if (!idRes.ok) {
          setStatus(idRes.status === 404 ? 'not-found' : 'error')
          setComments([])
          return
        }
        data = await idRes.json()
      } else {
        setStatus('error')
        setComments([])
        return
      }

      const retrievedPost = data.post as ApiPost
      const canonical = data.paths as CanonicalPaths
      const commentTree = normalizeCommentTree((data as { comments?: ApiComment[] }).comments ?? [])

      const provinceMatches = retrievedPost.provinceCode?.toLowerCase() === provinceParam.toLowerCase()
      const communityMatches = retrievedPost.communitySlug?.toLowerCase() === chamberParam.toLowerCase()

      if (!provinceMatches || !communityMatches) {
        if (canonical?.community) {
          if (/^https?:\/\//i.test(canonical.community)) {
            try {
              const url = new URL(canonical.community)
              if (url.origin === window.location.origin) {
                router.replace(`${url.pathname}${url.search}${url.hash}`)
              } else {
                window.location.replace(canonical.community)
              }
            } catch {
              window.location.replace(canonical.community)
            }
          } else {
            router.replace(canonical.community)
          }
          return
        }
      }

      setPost(retrievedPost)
      setComments(commentTree)
      setAppliedCommentSort(sortMode)
      setStatus('loaded')
    } catch (err) {
      console.error('Failed loading post', err)
      setComments([])
      setStatus('error')
    }
  }, [chamberParam, provinceParam, router, slugParam])

  const postId = post?.id
  useRegisterPageView(postId)
  const viewerReaction = post?.viewer?.reaction ?? null
  const shareTarget = useMemo(() => (post ? buildPostShareTarget(post) : null), [post])
  const postBodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromText(post?.body), [post?.body])
  const postArticleBodyWithoutCivilLinks = useMemo(() => stripCivilUrlsFromHtml(post?.body), [post?.body])

  const handleReact = useCallback(
    async (reaction: ReactionType | null) => {
      if (!post?.id || pendingVote) return
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      setPendingVote(true)
      try {
        const response = await fetch('/api/posts/react', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ postId: post.id, reaction }),
        })
        if (!response.ok) {
          console.error('Reaction request failed', await response.text())
          return
        }
        const data = await response.json().catch(() => null)
        const updated = (data as { post?: ApiPost })?.post
        if (updated) {
          setPost(updated)
        }
      } catch (err) {
        console.error('Unable to react to post', err)
      } finally {
        setPendingVote(false)
      }
    },
    [pendingVote, post?.id],
  )

  const loadComments = useCallback(
    async (sortMode: 'hot' | 'new') => {
      if (!postId) return
      try {
        const res = await fetch(`/api/posts/${postId}/comments?sort=${sortMode}`)
        if (!res.ok) {
          console.error('Failed loading comments', res.status)
          return
        }
        const data = await res.json()
        const commentTree = normalizeCommentTree((data as { comments?: ApiComment[] }).comments ?? [])
        setComments(commentTree)
        setAppliedCommentSort(sortMode)
      } catch (err) {
        console.error('Failed loading comments', err)
      }
    },
    [postId],
  )

  useEffect(() => {
    loadViewer().catch(() => {
      /* noop */
    })
  }, [loadViewer])

  useEffect(() => {
    loadPost('hot').catch(() => {
      /* noop */
    })
  }, [loadPost])

  useEffect(() => {
    if (!postId) return
    if (commentSort === appliedCommentSort) return
    loadComments(commentSort).catch(() => {
      /* noop */
    })
  }, [appliedCommentSort, commentSort, loadComments, postId])

  const loadRightRail = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const headers = token ? { authorization: `Bearer ${token}` } : undefined

      const [postsRes, orgsRes] = await Promise.all([
        fetch(buildApiUrl(`/posts?scope=communities&province=${encodeURIComponent(provinceParam)}&community=${encodeURIComponent(chamberParam)}&limit=12`), {
          headers,
          cache: 'no-store',
        }),
        fetch(buildApiUrl(`/communities/${encodeURIComponent(provinceParam)}/${encodeURIComponent(chamberParam)}/orgs?limit=5`), {
          headers,
        }),
      ])

      if (postsRes.ok) {
        const postsPayload = (await postsRes.json().catch(() => null)) as { items?: ApiPost[] } | null
        const items = Array.isArray(postsPayload?.items) ? postsPayload.items : []
        const filtered = post
          ? items.filter((item) => item.id !== post.id)
          : items
        setRailPosts(filtered.slice(0, 5))
      } else {
        setRailPosts([])
      }

      if (orgsRes.ok) {
        const orgPayload = (await orgsRes.json().catch(() => null)) as { items?: CommunityOrgItem[] } | null
        setRailOrganizations(Array.isArray(orgPayload?.items) ? orgPayload.items.slice(0, 5) : [])
      } else {
        setRailOrganizations([])
      }
    } catch (err) {
      console.error('Unable to load community right rail', err)
      setRailPosts([])
      setRailOrganizations([])
    }
  }, [chamberParam, post, provinceParam])

  useEffect(() => {
    loadRightRail().catch(() => {
      /* noop */
    })
  }, [loadRightRail])

  const handleReply = useCallback(
    async (parentId: string | null, body: string) => {
      if (!post) throw new Error('post_not_loaded')
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        throw new Error('auth_required')
      }

      const requestPayload: Record<string, unknown> = { postId: post.id, body }
      if (parentId) {
        requestPayload.parentId = parentId
      }

      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      })

      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw new Error(message || 'comment_failed')
      }

      const responseData = await response.json().catch(() => null)
      const newComment = (responseData as { comment?: ApiComment })?.comment
      const updatedPost = (responseData as { post?: ApiPost | null })?.post

      if (newComment) {
        setComments((prev) => addCommentToTree(prev, newComment))
        void loadComments(commentSort)
      }
      if (updatedPost) {
        setPost(updatedPost)
      }
    },
    [commentSort, loadComments, post],
  )

  const handleCommentVote = useCallback(async (commentId: string, value: -1 | 0 | 1) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      throw new Error('auth_required')
    }

    const response = await fetch('/api/comments/vote', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ commentId, value }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || 'vote_failed')
    }

    const responseData = await response.json().catch(() => null)
    const updatedComment = (responseData as { comment?: ApiComment | null })?.comment
    if (updatedComment) {
      setComments((prev) => updateCommentInTree(prev, updatedComment))
      void loadComments(commentSort)
    }
  }, [commentSort, loadComments])

  const handleCommentReported = useCallback((commentId: string) => {
    setComments((prev) => removeCommentFromTree(prev, commentId))
  }, [])

  const handleCommentAuthorBlocked = useCallback((authorId: string) => {
    setComments((prev) => removeCommentsByAuthorFromTree(prev, authorId))
  }, [])

  const communityDisplayName = (post?.communityName ?? chamberParam)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  const rightRail = (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">More in {communityDisplayName}</div>
          <Link href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`} className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            View all
          </Link>
        </div>
        {railPosts.length ? (
          <ul className="mt-3 space-y-3">
            {railPosts.map((item) => {
              const itemCommunityHref = item.provinceCode && item.communitySlug
                ? `/${item.provinceCode.toLowerCase()}/${item.communitySlug.toLowerCase()}/posts/${item.seoSlug ?? item.id}`
                : `/u/${item.author.handle}/posts/${item.seoSlug ?? item.id}`
              const itemCover = item.organization?.coverUrl ?? item.author.coverUrl ?? null
              const itemAvatar = item.organization?.logoUrl ?? item.author.avatarUrl
              const itemName = item.organization?.name ?? (formatUserDisplayName(item.author.name, item.author.handle) || item.author.handle)
              const imageThumb = item.mediaUrl ?? (Array.isArray(item.images) ? item.images[0] ?? null : null)

              return (
                <li key={item.id}>
                  <Link href={itemCommunityHref} className="block rounded-lg border border-slate-200 p-2 hover:bg-slate-50">
                    <CivilCard
                      href={itemCommunityHref}
                      size="sm"
                      name={itemName}
                      avatarAlt={itemName}
                      avatarInitials={itemName}
                      avatarSrc={itemAvatar}
                      coverUrl={itemCover}
                      isVerified={Boolean(item.organization?.isVerified ?? item.author.isVerified)}
                      isBusiness={Boolean(item.organization) || Boolean(item.author.isPremium)}
                      className="w-full border-slate-200"
                    />

                    <div className="mt-2 flex items-start gap-2">
                      <p className="line-clamp-2 min-w-0 flex-1 text-sm text-slate-700">
                        {item.title?.trim() || item.body}
                      </p>
                      {imageThumb ? (
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                          <img src={imageThumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No additional posts available yet.</p>
        )}
      </div>

      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">Organizations in {communityDisplayName}</div>
          <Link href={`/com/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}/orgs`} className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            View all
          </Link>
        </div>
        {railOrganizations.length ? (
          <ul className="mt-3 space-y-3">
            {railOrganizations.map((org) => {
              const href = org.provinceCode && org.communitySlug
                ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`
                : '/organizations/directory'
              return (
                <li key={org.id}>
                  <CivilCard
                    href={href}
                    size="md"
                    name={org.name}
                    avatarAlt={org.name}
                    avatarInitials={org.name}
                    avatarSrc={org.logoUrl ?? null}
                    coverUrl={org.coverUrl ?? null}
                    isVerified={Boolean(org.isVerified)}
                    isBusiness
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No organizations found yet.</p>
        )}
      </div>
    </div>
  )

  const postAuthorDisplayName = post ? formatUserDisplayName(post.author.name, post.author.handle) || post.author.handle : ''
  const showOrganizationAuthorBox = Boolean(post?.organization && post.showBusinessAuthor)
  const postOrganization = post?.organization ?? null
  const authorProfileHref = postOrganization?.provinceCode && postOrganization.communitySlug
    ? `/com/${postOrganization.provinceCode.toLowerCase()}/${postOrganization.communitySlug.toLowerCase()}/orgs/${postOrganization.slug}`
    : post
      ? `/u/${post.author.handle}`
      : '/home'
  const headerCoverUrl = postOrganization?.coverUrl ?? post?.author.coverUrl ?? null
  const breadcrumbCommunityName = communityDisplayName
  const isAuthor = Boolean(viewer?.id && post?.author.id && viewer.id === post.author.id)
  const reportTargetLabel = post?.title?.trim() || postOrganization?.name || postAuthorDisplayName || 'Post'
  const blockTarget = post
    ? postOrganization
      ? {
          type: 'organization' as const,
          id: postOrganization.id,
          label: postOrganization.name,
        }
      : {
          type: 'user' as const,
          id: post.author.id,
          label: postAuthorDisplayName || post.author.handle,
        }
    : null
  const postDeletedRedirectHref = `/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`
  const postSettingsActions = isAuthor
    ? [
        {
          key: 'delete',
          label: 'Delete',
          icon: HiTrash,
          tone: 'danger' as const,
          onSelect: async () => {
            if (!post) return
            if (!window.confirm('Are you sure you want to delete this post?')) return

            const token = getStoredToken()
            if (!token) {
              redirectToAuthModal('login')
              return
            }

            try {
              const response = await fetch(buildApiUrl(`/posts/${encodeURIComponent(post.id)}`), {
                method: 'DELETE',
                headers: {
                  authorization: `Bearer ${token}`,
                },
              })

              if (!response.ok) {
                pushToast('Failed to delete post.', 'error')
                return
              }

              pushToast('Post deleted.', 'success')
              router.push(postDeletedRedirectHref)
            } catch {
              pushToast('Failed to delete post.', 'error')
            }
          },
        },
      ]
    : []

  return (
    <DashboardShell
      rightRail={rightRail}
      mainClassName="space-y-5 lg:min-h-[calc(100vh-48px)]"
    >
      {status === 'loading' ? (
        <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Loading post…</div>
      ) : status === 'not-found' ? (
        <div className="rounded border bg-white p-6 text-sm text-gray-500 shadow-sm">Post not found.</div>
      ) : status === 'error' ? (
        <div className="rounded border bg-white p-6 text-sm text-red-600 shadow-sm">Unable to load this post right now.</div>
      ) : post ? (
        <article className="rounded border bg-white p-6 shadow-sm">
          <nav className="mb-4 text-xs text-gray-500">
            <Link href="/home" className="hover:underline">
              Home
            </Link>
            <span className="mx-1">/</span>
            <Link
              href={`/${provinceParam.toLowerCase()}/${chamberParam.toLowerCase()}`}
              className="hover:underline"
            >
              {breadcrumbCommunityName}
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">Post</span>
          </nav>

          <header className="relative space-y-4 border-b border-gray-100 pb-4">
            <CivilCard
              size="banner"
              name={postOrganization?.name ?? postAuthorDisplayName}
              subtitle={`@${post.author.handle} • ${formatDateTime(post.createdAt)}`}
              details={
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/85">
                  <span className="rounded-full border border-white/35 px-2 py-0.5 text-white/85">
                    {JURISDICTION_LABELS[post.jurisdiction]}
                  </span>
                  {post.provinceCode && post.communitySlug ? (
                    <Link
                      href={`/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}`}
                      className="rounded-full border border-white/35 px-2 py-0.5 uppercase tracking-wide text-white/85 hover:border-white/60"
                    >
                      {post.communityName ?? post.communitySlug}
                    </Link>
                  ) : null}
                </div>
              }
              avatarAlt={postAuthorDisplayName}
              avatarInitials={postAuthorDisplayName}
              avatarSrc={postOrganization ? (postOrganization.logoUrl ?? null) : post.author.avatarUrl}
              avatarHref={authorProfileHref}
              titleHref={authorProfileHref}
              coverUrl={headerCoverUrl}
              isVerified={postOrganization ? Boolean(postOrganization.isVerified) : Boolean(post.author.isVerified)}
              isBusiness={postOrganization ? true : Boolean(post.author.isPremium)}
              contentClassName="pr-14"
              trailing={
                showOrganizationAuthorBox ? <PostAuthorMiniCard author={post.author} className="hidden w-[210px] md:block" /> : null
              }
            />
            {showOrganizationAuthorBox ? (
              <div className="flex justify-end md:hidden">
                <PostAuthorMiniCard author={post.author} className="w-full max-w-[220px]" />
              </div>
            ) : null}
            <div className="absolute right-3 top-3 z-20">
              <ContentModerationMenu
                actions={postSettingsActions}
                reportTarget={
                  post && !isAuthor
                    ? {
                        targetType: 'POST',
                        targetId: post.id,
                        targetLabel: reportTargetLabel,
                      }
                    : null
                }
                blockTarget={post && !isAuthor ? blockTarget : null}
                buttonLabel={isAuthor ? 'Post actions' : 'Post settings'}
                onReported={() => router.push(postDeletedRedirectHref)}
                onBlocked={() => router.push(postDeletedRedirectHref)}
              />
            </div>

            <div className="space-y-4 text-[16px] leading-7 text-gray-900">
              {post.mediaUrl ? (
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  <img
                    src={post.mediaUrl}
                    alt={post.title || post.body || 'Post image'}
                    className="h-auto w-full max-h-[75vh] object-contain bg-gray-900/5"
                    loading="lazy"
                  />
                </div>
              ) : null}
              {post.type === 'article' && post.title ? (
                <h1 className="text-2xl font-semibold text-gray-900">{post.title}</h1>
              ) : null}
              {post.type === 'article' ? (
                postArticleBodyWithoutCivilLinks ? (
                  <div className="cc-article-rich-content" dangerouslySetInnerHTML={{ __html: postArticleBodyWithoutCivilLinks }} />
                ) : null
              ) : postBodyWithoutCivilLinks ? (
                <div className="whitespace-pre-wrap">{postBodyWithoutCivilLinks}</div>
              ) : null}
              <CivilLinkPreviewList body={post.body} className="mt-3 space-y-2" />
              {post.type === 'poll' && post.poll ? (
                <PollCard
                  post={post}
                  viewerId={viewer?.id ?? null}
                  onPostUpdate={setPost}
                  variant="detail"
                />
              ) : null}
            </div>
          </header>

          <footer className="mt-6 space-y-3 text-xs text-gray-500">
            <div className="space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-500">
              <div className="flex w-full justify-center sm:justify-start">
                <PostReactionBar
                  className="w-full justify-center sm:w-auto sm:justify-start"
                  reactions={post.reactions}
                  viewerReaction={viewerReaction}
                  disabled={pendingVote}
                  onReact={(reaction) => handleReact(reaction)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                {post.counts ? (
                  <a
                    href="#comments"
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    aria-label="Open comments"
                  >
                    <LuMessageCircle className="h-4 w-4" />
                    <span>{post.counts.commentCount}</span>
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRepostModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <LuRepeat2 className="h-4 w-4" />
                  <span>Repost</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShareModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <LuShare className="h-4 w-4" />
                  <span>Share</span>
                </button>
              </div>
            </div>
          </footer>

          <section id="comments" className="mt-6">
            <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-wide text-gray-500">
              <div className="flex gap-3 font-semibold">
                {COMMENT_SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`pb-1 transition ${
                      commentSort === option.value
                        ? 'border-b-2 border-[var(--cc-primary)] text-[var(--cc-primary)]'
                        : 'text-gray-400 hover:text-[var(--cc-primary)]'
                    }`}
                    onClick={() => setCommentSort(option.value)}
                    disabled={commentSort === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {viewer ? (
              <CommentComposer className="mt-4 hidden lg:block" onSubmit={(body) => handleReply(null, body)} />
            ) : (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <span>Sign in to join the conversation.</span>
                <button
                  type="button"
                  onClick={() => redirectToAuthModal('login')}
                  className="inline-flex items-center bg-[var(--cc-primary)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)]"
                >
                  Sign in
                </button>
              </div>
            )}

            <div className="mt-6">
              <CommentThread
                comments={comments}
                onReply={handleReply}
                onVote={handleCommentVote}
                onCommentReported={handleCommentReported}
                onCommentAuthorBlocked={handleCommentAuthorBlocked}
                currentUser={viewer}
              />
            </div>
            {viewer ? <div className="h-28 lg:hidden" aria-hidden="true" /> : null}
          </section>

          {repostModalOpen && shareTarget ? (
            <SharePostModal
              target={shareTarget}
              onClose={() => setRepostModalOpen(false)}
            />
          ) : null}

          {shareModalOpen && shareTarget ? (
            <ShareSendModal
              target={shareTarget}
              onClose={() => setShareModalOpen(false)}
            />
          ) : null}
          {viewer ? <ThreadBottomCommentComposer onSubmit={(body) => handleReply(null, body)} /> : null}
        </article>
      ) : null}
    </DashboardShell>
  )
}
