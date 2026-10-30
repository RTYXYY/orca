import { useEffect, useMemo, useRef, useState } from 'react'
import type { PRComment } from '../../../../../shared/github/comment-types'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/github/worktree-refresh'
import { useRepoById } from '@/store/selectors'
import { fetchBitbucketPRComments, replyToBitbucketPRComment } from './bitbucket-pr-comment-rpc'
import { buildBitbucketInlineReviewComments } from './bitbucket-pr-inline-comments'

export type BitbucketInlineCommentThread = {
  /** Root comment of the thread, used as the reply parent. */
  rootId: number
  comments: PRComment[]
}

const EMPTY_COMMENTS: PRComment[] = []

/**
 * Loads the linked Bitbucket Data Center PR's comments for a worktree's branch diff,
 * mirrored on GitHub's PR inline comments: fetched once per PR, mapped per line.
 */
export function useBitbucketPRDiffComments(worktreeId: string): {
  inlineComments: ReturnType<typeof buildBitbucketInlineReviewComments>
  comments: PRComment[]
  replyToComment: (parentCommentId: number, body: string) => Promise<boolean>
} {
  const repoId = useAppStore((s) => findWorktreeById(s, worktreeId)?.repoId ?? null)
  const repo = useRepoById(repoId)
  const linkedPRNumber = useAppStore(
    (s) => findWorktreeById(s, worktreeId)?.linkedBitbucketPR ?? null
  )
  const [comments, setComments] = useState<PRComment[]>(EMPTY_COMMENTS)
  const inflightRef = useRef<string | null>(null)

  const fetchKey = repo && linkedPRNumber != null ? `${repo.id}::${linkedPRNumber}` : null

  useEffect(() => {
    if (!repo || linkedPRNumber == null) {
      setComments(EMPTY_COMMENTS)
      return
    }
    const prNumber = linkedPRNumber
    // Why: a PR switch during an in-flight fetch must not write stale comments into the new PR's view.
    const key = `${repo.id}::${prNumber}`
    if (inflightRef.current === key) {
      return
    }
    inflightRef.current = key
    let cancelled = false
    void fetchBitbucketPRComments({ repo, prNumber })
      .then((result) => {
        if (cancelled) {
          return
        }
        if (result.ok) {
          setComments(result.comments)
        } else {
          setComments(EMPTY_COMMENTS)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComments(EMPTY_COMMENTS)
        }
      })
      .finally(() => {
        if (!cancelled) {
          inflightRef.current = null
        }
      })
    return () => {
      cancelled = true
    }
  }, [fetchKey, linkedPRNumber, repo])

  const repoRef = useRef(repo)
  repoRef.current = repo

  const replyToComment = async (parentCommentId: number, body: string): Promise<boolean> => {
    const currentRepo = repoRef.current
    if (!currentRepo || linkedPRNumber == null) {
      return false
    }
    const result = await replyToBitbucketPRComment({
      repo: currentRepo,
      prNumber: linkedPRNumber,
      parentCommentId,
      body
    })
    if (!result.ok) {
      return false
    }
    setComments((prev) => [...prev, result.comment])
    return true
  }

  const replyToCommentRef = useRef(replyToComment)
  replyToCommentRef.current = replyToComment

  const inlineComments = useMemo(() => {
    if (!repoId || linkedPRNumber == null) {
      return []
    }
    // Why: attach the reply callback per thread root; replies append to the thread and re-render zones.
    const rootById = new Map<number, PRComment>()
    for (const comment of comments) {
      const rootId = Number(comment.threadId)
      if (Number.isFinite(rootId) && rootId > 0 && !rootById.has(rootId)) {
        const root = comments.find((c) => c.id === rootId)
        if (root) {
          rootById.set(rootId, root)
        }
      }
    }
    return buildBitbucketInlineReviewComments(comments, repoId, linkedPRNumber).map((c, i) => {
      const source = comments[i]
      const parentId = source ? Number(source.threadId) : Number.NaN
      return {
        ...c,
        onReply:
          Number.isFinite(parentId) && parentId > 0
            ? (body: string) => replyToCommentRef.current(parentId, body)
            : undefined
      }
    })
  }, [comments, linkedPRNumber, repoId])

  return { inlineComments, comments, replyToComment }
}
