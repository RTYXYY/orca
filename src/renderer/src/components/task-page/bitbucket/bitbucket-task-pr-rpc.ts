import type { Repo } from '../../../../../shared/repo-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { BitbucketWorkItem, BitbucketTaskFilter } from '../../../../../shared/bitbucket-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

type BitbucketServerPRSummary = {
  number: number
  title: string
  state: 'open' | 'merged' | 'closed' | 'draft'
  url: string
  author: string
  authorAvatarUrl: string
  branchName: string
  targetBranchName: string
  updatedAt: string
  isDraft: boolean
  reviewDecision: BitbucketWorkItem['reviewDecision']
  isMergeable: boolean
}

type BitbucketPRListResult =
  | { ok: true; prs: BitbucketServerPRSummary[] }
  | { ok: false; error: string }

function bitbucketRpcTarget(repo: Repo): RuntimeClientTarget {
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  return host?.kind === 'runtime'
    ? { kind: 'environment', environmentId: host.environmentId }
    : { kind: 'local' }
}

/** Lists a repo's Bitbucket Data Center pull requests for the task page. */
export async function listBitbucketTaskPRs(args: {
  repo: Repo
  filter: BitbucketTaskFilter
}): Promise<{ items: BitbucketWorkItem[]; error: string | null }> {
  try {
    const result = await callRuntimeRpc<BitbucketPRListResult>(
      bitbucketRpcTarget(args.repo),
      'bitbucket.listPRs',
      { repo: args.repo.id, filter: args.filter }
    )
    if (!result.ok) {
      return { items: [], error: result.error }
    }
    return {
      items: result.prs.map((pr): BitbucketWorkItem => ({
        id: `${args.repo.id}:${pr.number}`,
        type: 'pr',
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.url,
        updatedAt: pr.updatedAt,
        author: pr.author || null,
        branchName: pr.branchName || undefined,
        baseRefName: pr.targetBranchName || undefined,
        isDraft: pr.isDraft,
        reviewDecision: pr.reviewDecision ?? null,
        repoId: args.repo.id
      })),
      error: null
    }
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : 'Could not list pull requests.'
    }
  }
}
