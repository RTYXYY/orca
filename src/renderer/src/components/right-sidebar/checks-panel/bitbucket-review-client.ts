import type { PRCheckDetail } from '../../../../../shared/github/check-types'
import type { PRComment } from '../../../../../shared/github/comment-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { HostedReviewInfo } from '../../../../../shared/source-control/hosted-review/hosted-review-contracts'
import type { ChecksPanelReview } from './checks-panel-review'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../../shared/execution-host'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { RightPanelCommentSubmitResult } from './comments/right-panel-comment-composer'

export type BitbucketPRCommentsResult =
  | { ok: true; comments: PRComment[] }
  | { ok: false; error: string }

export type BitbucketAddCommentResult =
  | { ok: true; comment: PRComment }
  | { ok: false; error: string }

function getBitbucketReviewTarget(repo: Repo): RuntimeClientTarget {
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  return host?.kind === 'runtime'
    ? { kind: 'environment', environmentId: host.environmentId }
    : { kind: 'local' }
}

export function isBitbucketChecksPanelReview(
  review: ChecksPanelReview | null
): review is ChecksPanelReview & { provider: 'bitbucket' } {
  return review?.provider === 'bitbucket'
}

/** Map the aggregate Data Center build status onto one ChecksList row; DC has no per-check list. */
export function bitbucketReviewToPRChecks(review: HostedReviewInfo): PRCheckDetail[] {
  if (review.state !== 'open' && review.state !== 'draft') {
    return []
  }
  const status = review.status
  if (status === 'neutral') {
    return []
  }
  const detail: PRCheckDetail = {
    name: 'Bitbucket build status',
    status: status === 'pending' ? 'in_progress' : 'completed',
    conclusion: status === 'pending' ? 'pending' : status,
    url: review.url || null
  }
  return [detail]
}

export async function fetchBitbucketReviewComments(args: {
  repo: Repo
  prNumber: number
}): Promise<BitbucketPRCommentsResult> {
  const target = getBitbucketReviewTarget(args.repo)
  return callRuntimeRpc<BitbucketPRCommentsResult>(
    target,
    'bitbucket.prComments',
    { repo: args.repo.id, prNumber: args.prNumber },
    { timeoutMs: 30_000 }
  )
}

export async function addBitbucketReviewComment(args: {
  repo: Repo
  prNumber: number
  body: string
}): Promise<RightPanelCommentSubmitResult> {
  const target = getBitbucketReviewTarget(args.repo)
  const result = await callRuntimeRpc<BitbucketAddCommentResult>(
    target,
    'bitbucket.addPRComment',
    { repo: args.repo.id, prNumber: args.prNumber, body: args.body },
    { timeoutMs: 30_000 }
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function replyToBitbucketReviewComment(args: {
  repo: Repo
  prNumber: number
  parentCommentId: number
  body: string
}): Promise<BitbucketAddCommentResult> {
  const target = getBitbucketReviewTarget(args.repo)
  return callRuntimeRpc<BitbucketAddCommentResult>(
    target,
    'bitbucket.addPRCommentReply',
    {
      repo: args.repo.id,
      prNumber: args.prNumber,
      parentCommentId: args.parentCommentId,
      body: args.body
    },
    { timeoutMs: 30_000 }
  )
}

export type BitbucketResolveThreadResult = { ok: true } | { ok: false; error?: string }

export async function resolveBitbucketPRCommentThread(args: {
  repoPath: string
  repoId: string
  prNumber: number
  threadId: string
}): Promise<BitbucketResolveThreadResult> {
  const threadRootCommentId = Number(args.threadId)
  if (!Number.isSafeInteger(threadRootCommentId) || threadRootCommentId <= 0) {
    return { ok: false, error: 'Invalid Bitbucket comment thread id.' }
  }
  // SAFETY: repoId selectors are resolved server-side; the path is only a fallback hint.
  const repo = { id: args.repoId, path: args.repoPath } as unknown as Repo
  const target = getBitbucketReviewTarget(repo)
  return callRuntimeRpc<BitbucketResolveThreadResult>(
    target,
    'bitbucket.resolvePRCommentThread',
    {
      repo: args.repoId,
      prNumber: args.prNumber,
      threadRootCommentId,
      resolved: true
    },
    { timeoutMs: 30_000 }
  )
}
