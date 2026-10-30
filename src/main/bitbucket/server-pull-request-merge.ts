import type { ExecutionHostId } from '../../shared/execution-host'
import {
  HostedReviewApiRequestError,
  requestHostedReviewJson
} from '../source-control/hosted-review-api-request'
import { hostedReviewSshConnectionId } from '../source-control/hosted-review-execution-host'
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import { resolveBitbucketServerAuthConfig, serverAuthHeaders } from './server-auth-config'
import { bitbucketServerRepoApiPath } from './server-client'
import { serverErrorMessage } from './server-request-errors'
import { getBitbucketServerRepoRef } from './server-repository-ref'

const MERGE_REQUEST_TIMEOUT_MS = 60_000
const LOOKUP_TIMEOUT_MS = 5000

export type MergeBitbucketServerPullRequestResult =
  | { ok: true }
  | { ok: false; error: string; code?: 'auth_required' | 'conflict' | 'not_found' }

function classifyMergeError(error: unknown): MergeBitbucketServerPullRequestResult {
  console.warn(
    'mergeBitbucketServerPullRequest failed:',
    error instanceof Error ? error.message : String(error)
  )
  if (!(error instanceof HostedReviewApiRequestError)) {
    return {
      ok: false,
      error:
        'Merge failed: Bitbucket Data Center could not merge the pull request. Try again in a moment.'
    }
  }
  if (error.status === 401 || error.status === 403) {
    return {
      ok: false,
      code: 'auth_required',
      error:
        'Merge failed: Bitbucket Data Center rejected the credentials. Check the connection in Settings > Integrations.'
    }
  }
  if (error.status === 404) {
    return {
      ok: false,
      code: 'not_found',
      error: 'Merge failed: the pull request could not be found. Refresh and try again.'
    }
  }
  if (error.status === 409) {
    return {
      ok: false,
      code: 'conflict',
      error:
        'Merge failed: the pull request changed on the server (new commits or version conflict). Refresh and try again.'
    }
  }
  const reason = serverErrorMessage(error)
  return {
    ok: false,
    error: reason
      ? `Merge failed: Bitbucket Data Center rejected the merge: ${reason}`
      : 'Merge failed: Bitbucket Data Center rejected the merge. Check approvals, checks, and conflicts, then try again.'
  }
}

async function getPullRequestVersion(
  config: ReturnType<typeof resolveBitbucketServerAuthConfig>,
  baseUrl: string,
  repoApiPath: string,
  prNumber: number
): Promise<number | null> {
  try {
    const raw = await requestHostedReviewJson<{ version?: number }>(
      new URL(`${baseUrl}${repoApiPath}/pull-requests/${encodeURIComponent(String(prNumber))}`),
      { headers: { Accept: 'application/json', ...serverAuthHeaders(config) } },
      LOOKUP_TIMEOUT_MS
    )
    return typeof raw.version === 'number' ? raw.version : null
  } catch {
    return null
  }
}

export async function mergeBitbucketServerPullRequest(
  repoPath: string,
  prNumber: number,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<MergeBitbucketServerPullRequestResult> {
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return {
      ok: false,
      code: 'auth_required',
      error:
        'Merge failed: Bitbucket Data Center is not connected. Next step: connect Bitbucket Data Center in Settings > Integrations.'
    }
  }
  const repo = await getBitbucketServerRepoRef(
    repoPath,
    connectionId ?? hostedReviewSshConnectionId(executionHostId),
    getHostedReviewLocalGitOptions(options)
  )
  if (!repo) {
    return {
      ok: false,
      error: 'Merging pull requests requires a Bitbucket Data Center remote.'
    }
  }
  const repoApiPath = bitbucketServerRepoApiPath(repo)
  // Why: the merge POST requires the PR's current version as an optimistic lock.
  const version = await getPullRequestVersion(config, repo.baseUrl, repoApiPath, prNumber)
  if (version === null) {
    return {
      ok: false,
      error:
        'Merge failed: could not read the pull request version. Refresh the pull request and try again.'
    }
  }
  const url = new URL(
    `${repo.baseUrl}${repoApiPath}/pull-requests/${encodeURIComponent(String(prNumber))}/merge`
  )
  url.searchParams.set('version', String(version))
  try {
    await requestHostedReviewJson(
      url,
      {
        method: 'POST',
        headers: { Accept: 'application/json', ...serverAuthHeaders(config) }
      },
      MERGE_REQUEST_TIMEOUT_MS
    )
    return { ok: true }
  } catch (error) {
    return classifyMergeError(error)
  }
}
