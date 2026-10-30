import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export type BitbucketMergeResult = { ok: true } | { ok: false; error: string; code?: string }

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
