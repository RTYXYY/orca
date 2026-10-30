import type { Repo } from '../../../../../shared/repo-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { PRComment } from '../../../../../shared/github/comment-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

export type BitbucketPRCommentsResult =
  | { ok: true; comments: PRComment[] }
  | { ok: false; error: string }

export type BitbucketCommentMutationResult =
  | { ok: true; comment: PRComment }
  | { ok: false; error: string }

function getBitbucketActionTarget(repo: Repo): RuntimeClientTarget {
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  return host?.kind === 'runtime'
    ? { kind: 'environment', environmentId: host.environmentId }
    : { kind: 'local' }
}

export function fetchBitbucketPRComments(args: {
  repo: Repo
  prNumber: number
}): Promise<BitbucketPRCommentsResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketPRCommentsResult>(target, 'bitbucket.prComments', {
    repo: args.repo.id,
    prNumber: args.prNumber
  })
}

export function replyToBitbucketPRComment(args: {
  repo: Repo
  prNumber: number
  parentCommentId: number
  body: string
}): Promise<BitbucketCommentMutationResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketCommentMutationResult>(target, 'bitbucket.addPRCommentReply', {
    repo: args.repo.id,
    prNumber: args.prNumber,
    parentCommentId: args.parentCommentId,
    body: args.body
  })
}

export function addBitbucketPRLineComment(args: {
  repo: Repo
  prNumber: number
  path: string
  line: number
  body: string
  srcPath?: string
  fromHash?: string
  toHash?: string
}): Promise<BitbucketCommentMutationResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketCommentMutationResult>(target, 'bitbucket.addPRLineComment', {
    repo: args.repo.id,
    prNumber: args.prNumber,
    path: args.path,
    line: args.line,
    body: args.body,
    ...(args.srcPath ? { srcPath: args.srcPath } : {}),
    ...(args.fromHash ? { fromHash: args.fromHash } : {}),
    ...(args.toHash ? { toHash: args.toHash } : {})
  })
}
