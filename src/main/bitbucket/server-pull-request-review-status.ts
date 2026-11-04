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
import { invalidateHostedReviewBranchCache } from '../source-control/hosted-review-branch-cache'
import { resolveBitbucketServerAuthConfig, serverAuthHeaders } from './server-auth-config'
import { bitbucketServerRepoApiPath } from './server-client'
import { serverErrorMessage } from './server-request-errors'
import { getBitbucketServerRepoRef } from './server-repository-ref'

const STATUS_TIMEOUT_MS = 15_000

export type BitbucketServerPRReviewStatus = 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED'

export type SetBitbucketServerPRReviewStatusResult =
  | { ok: true; status: BitbucketServerPRReviewStatus }
  | {
      ok: false
      error: string
      code?: 'auth_required' | 'not_found' | 'conflict' | 'author'
    }

function classifyStatusError(
  error: unknown,
  actionLabel: string
): SetBitbucketServerPRReviewStatusResult {
  console.warn(
    'setBitbucketServerPRReviewStatus failed:',
    error instanceof Error ? error.message : String(error)
  )
  if (!(error instanceof HostedReviewApiRequestError)) {
    return {
      ok: false,
      error: `${actionLabel} failed: Bitbucket Data Center could not be reached. Try again in a moment.`
    }
  }
  if (error.status === 401 || error.status === 403) {
    return {
      ok: false,
      code: 'auth_required',
      error: `${actionLabel} failed: Bitbucket Data Center rejected the credentials. Check the connection in Settings > Integrations.`
    }
  }
  if (error.status === 404) {
    return {
      ok: false,
      code: 'not_found',
      error: `${actionLabel} failed: the pull request could not be found. Refresh and try again.`
    }
  }
  if (error.status === 409) {
    return {
      ok: false,
      code: 'conflict',
      error: `${actionLabel} failed: the pull request is not open, or changed on the server. Refresh and try again.`
    }
  }
  // Why: DC answers 400 when the current user authored the PR; other 400s surface the server's message.
  if (error.status === 400) {
    const reason = serverErrorMessage(error)
    if (reason) {
      return { ok: false, error: `${actionLabel} failed: ${reason}` }
    }
    return {
      ok: false,
      code: 'author',
      error: `${actionLabel} failed: the pull request author cannot review their own pull request.`
    }
  }
  const reason = serverErrorMessage(error)
  return {
    ok: false,
    error: reason
      ? `${actionLabel} failed: ${reason}`
      : `${actionLabel} failed: Bitbucket Data Center rejected the request.`
  }
}

export async function setBitbucketServerPRReviewStatus(
  repoPath: string,
  prNumber: number,
  status: BitbucketServerPRReviewStatus,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<SetBitbucketServerPRReviewStatusResult> {
  const actionLabel =
    status === 'APPROVED' ? 'Approve' : status === 'NEEDS_WORK' ? 'Needs work' : 'Undo review'
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return {
      ok: false,
      code: 'auth_required',
      error: `${actionLabel} failed: Bitbucket Data Center is not connected. Next step: connect Bitbucket Data Center in Settings > Integrations.`
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
      error: `${actionLabel} requires a Bitbucket Data Center remote.`
    }
  }
  // Why: the participants endpoint targets the authenticated user's slug; X-AUSERNAME is how Orca identifies the account elsewhere.
  const userSlug = await fetchCurrentUserSlug(config.baseUrl, config.accessToken)
  if (!userSlug) {
    return {
      ok: false,
      code: 'auth_required',
      error: `${actionLabel} failed: could not determine the authenticated Bitbucket Data Center user. Reconnect the integration and try again.`
    }
  }
  const url = new URL(
    `${repo.baseUrl}${bitbucketServerRepoApiPath(repo)}/pull-requests/${encodeURIComponent(
      String(prNumber)
    )}/participants/${encodeURIComponent(userSlug)}`
  )
  try {
    // Why: PUT UNAPPROVED clears the verdict but keeps the reviewer role; DELETE would drop the reviewer entirely.
    await requestHostedReviewJson(
      url,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...serverAuthHeaders(config)
        },
        body: JSON.stringify({ status, lastReviewedCommit: undefined })
      },
      STATUS_TIMEOUT_MS
    )
    // Why: mirror GitHub PR mutations — the post-mutation refresh must not join an older lookup or reuse its stale reviewDecision.
    invalidateHostedReviewBranchCache(repoPath, executionHostId)
    return { ok: true, status }
  } catch (error) {
    return classifyStatusError(error, actionLabel)
  }
}

// Why: /rest/api/1.0/users?limit=1 both proves the credential and returns X-AUSERNAME with the caller's slug.
async function fetchCurrentUserSlug(baseUrl: string, accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/rest/api/1.0/users?limit=1`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
    })
    if (!response.ok) {
      return null
    }
    // Why: cancel the unread body so the socket is freed without buffering the payload.
    await response.body?.cancel().catch(() => {})
    return response.headers.get('X-AUSERNAME')
  } catch {
    return null
  }
}
