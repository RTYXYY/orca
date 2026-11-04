import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export type BitbucketMergeResult = { ok: true } | { ok: false; error: string; code?: string }

export type BitbucketReviewStatus = 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED'

export type BitbucketSetReviewStatusResult =
  | { ok: true; status: BitbucketReviewStatus }
  | { ok: false; error: string; code?: string }

export type BitbucketPRTask = {
  id: number
  text: string
  state: 'OPEN' | 'RESOLVED'
  createdAt: string
  author: string
}

export type BitbucketPRTasksResult =
  | { ok: true; tasks: BitbucketPRTask[] }
  | { ok: false; error: string }

export type BitbucketAddPRTaskResult =
  | { ok: true; task: BitbucketPRTask }
  | { ok: false; error: string }

export type BitbucketSetPRTaskStateResult =
  | { ok: true; task: BitbucketPRTask }
  | { ok: false; error: string }

function getBitbucketActionTarget(repo: Repo): RuntimeClientTarget {
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  return host?.kind === 'runtime'
    ? { kind: 'environment', environmentId: host.environmentId }
    : { kind: 'local' }
}

export async function mergeBitbucketHostedReview(args: {
  repo: Repo
  prNumber: number
}): Promise<BitbucketMergeResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketMergeResult>(
    target,
    'bitbucket.mergePR',
    { repo: args.repo.id, prNumber: args.prNumber },
    // A Data Center merge with pre-merge checks can outlast a short poll.
    { timeoutMs: 90_000 }
  )
}

export async function setBitbucketHostedReviewStatus(args: {
  repo: Repo
  prNumber: number
  status: BitbucketReviewStatus
}): Promise<BitbucketSetReviewStatusResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketSetReviewStatusResult>(
    target,
    'bitbucket.setPRReviewStatus',
    { repo: args.repo.id, prNumber: args.prNumber, status: args.status },
    { timeoutMs: 30_000 }
  )
}

export async function getBitbucketHostedReviewTasks(args: {
  repo: Repo
  prNumber: number
}): Promise<BitbucketPRTasksResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketPRTasksResult>(
    target,
    'bitbucket.prTasks',
    { repo: args.repo.id, prNumber: args.prNumber },
    { timeoutMs: 30_000 }
  )
}

export async function addBitbucketHostedReviewTask(args: {
  repo: Repo
  prNumber: number
  text: string
}): Promise<BitbucketAddPRTaskResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketAddPRTaskResult>(
    target,
    'bitbucket.addPRTask',
    { repo: args.repo.id, prNumber: args.prNumber, text: args.text },
    { timeoutMs: 30_000 }
  )
}

export async function setBitbucketHostedReviewTaskState(args: {
  repo: Repo
  prNumber: number
  taskId: number
  state: 'OPEN' | 'RESOLVED'
}): Promise<BitbucketSetPRTaskStateResult> {
  const target = getBitbucketActionTarget(args.repo)
  return callRuntimeRpc<BitbucketSetPRTaskStateResult>(
    target,
    'bitbucket.setPRTaskState',
    {
      repo: args.repo.id,
      prNumber: args.prNumber,
      taskId: args.taskId,
      state: args.state
    },
    { timeoutMs: 30_000 }
  )
}
