import type { ApiComment } from '../_components/CommentThread'

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  const date = value ? new Date(value as any) : null
  if (date && !Number.isNaN(date.getTime())) {
    return date.toISOString()
  }
  return new Date().toISOString()
}

const sortByCreatedAt = (a: ApiComment, b: ApiComment) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

function normalizeVote(value: unknown): -1 | 0 | 1 {
  if (value === 1 || value === '1') return 1
  if (value === -1 || value === '-1') return -1
  return 0
}

function normalizeCommentNode(input: any): ApiComment {
  const replies = Array.isArray(input?.replies) ? input.replies : []
  const normalizedReplies = replies.map((child: any) => normalizeCommentNode(child)).sort(sortByCreatedAt)
  return {
    id: String(input?.id ?? ''),
    postId: String(input?.postId ?? ''),
    parentId: input?.parentId ? String(input.parentId) : null,
    body: String(input?.body ?? ''),
    createdAt: toIsoString(input?.createdAt),
    updatedAt: toIsoString(input?.updatedAt),
    upvotes: Number.isFinite(Number(input?.upvotes)) ? Number(input?.upvotes) : 0,
    downvotes: Number.isFinite(Number(input?.downvotes)) ? Number(input?.downvotes) : 0,
    score: Number.isFinite(Number(input?.score)) ? Number(input?.score) : 0,
    viewerVote: normalizeVote(input?.viewerVote ?? 0),
    hotScore: Number.isFinite(Number(input?.hotScore)) ? Number(input?.hotScore) : 0,
    author: {
      id: String(input?.author?.id ?? ''),
      handle: String(input?.author?.handle ?? ''),
      name: input?.author?.name ?? null,
      avatarUrl: input?.author?.avatarUrl ?? null,
      coverUrl: input?.author?.coverUrl ?? null,
      isPremium: Boolean(input?.author?.isPremium ?? input?.author?.isVerified),
      isVerified: Boolean(input?.author?.isVerified ?? input?.author?.isPremium),
    },
    replies: normalizedReplies,
  }
}

function insertIntoTree(nodes: ApiComment[], comment: ApiComment, parentId: string | null): { updated: ApiComment[]; inserted: boolean } {
  if (!parentId) {
    const withoutDuplicate = nodes.filter((node) => node.id !== comment.id)
    return { updated: [comment, ...withoutDuplicate], inserted: true }
  }

  let inserted = false
  const nextNodes = nodes.map((node) => {
    if (node.id === parentId) {
      inserted = true
      const withoutDuplicate = node.replies.filter((reply) => reply.id !== comment.id)
      return {
        ...node,
        replies: [comment, ...withoutDuplicate],
      }
    }
    const { updated: childReplies, inserted: childInserted } = insertIntoTree(node.replies, comment, parentId)
    if (childInserted) {
      inserted = true
      return {
        ...node,
        replies: childReplies,
      }
    }
    return node
  })

  if (!inserted) {
    const withoutDuplicate = nodes.filter((node) => node.id !== comment.id)
    return { updated: [comment, ...withoutDuplicate], inserted: false }
  }

  return { updated: nextNodes, inserted: true }
}

export function normalizeCommentTree(input: unknown): ApiComment[] {
  if (!Array.isArray(input)) return []
  return input.map((node) => normalizeCommentNode(node)).sort(sortByCreatedAt)
}

export function addCommentToTree(nodes: ApiComment[], comment: ApiComment): ApiComment[] {
  const normalized = normalizeCommentNode(comment)
  return insertIntoTree(nodes, normalized, normalized.parentId).updated
}

export function updateCommentInTree(nodes: ApiComment[], comment: ApiComment): ApiComment[] {
  const normalized = normalizeCommentNode(comment)
  let updated = false

  const walk = (list: ApiComment[]): ApiComment[] =>
    list.map((node) => {
      if (node.id === normalized.id) {
        updated = true
        const mergedReplies = normalized.replies.length ? normalized.replies : node.replies
        return {
          ...node,
          ...normalized,
          replies: mergedReplies,
        }
      }
      if (node.replies.length) {
        const nextReplies = walk(node.replies)
        if (nextReplies !== node.replies) {
          return {
            ...node,
            replies: nextReplies,
          }
        }
      }
      return node
    })

  const next = walk(nodes)
  return updated ? next : nodes
}
