import { shouldHideNonOpenReviewOnDefaultBranch } from '../source-control/repo-default-branch'
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import type { BitbucketPullRequestInfo } from './pull-request-mappers'
import {
  HostedReviewApiRequestError,
  serverRequestFailureMessage,
  serverRequestJson
} from './server-request'
import {
  bitbucketServerHeadSha,
  deriveBitbucketServerBuildStatus,
  deriveBitbucketServerMergeable,
  mapBitbucketServerPullRequest,
  mapBitbucketServerState,
  type RawBitbucketServerBuildStats,
  type RawBitbucketServerMerge,
  type RawBitbucketServerPullRequest
} from './server-pull-request-mappers'
import { getBitbucketServerRepoRef, type BitbucketServerRepoRef } from './server-repository-ref'

type RequestOptions = {
  searchParams?: Record<string, string>
  // Why: a failed lookup behind Create must throw, never read as "no PR".
  throwOnFailure?: boolean
  // Why: a stale linked PR number must fall through to the branch lookup.
  notFoundIsNull?: boolean
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
  try {
    return await serverRequestJson<T>(path, { searchParams: options.searchParams })
  } catch (error) {
    if (
      options.notFoundIsNull &&
      error instanceof HostedReviewApiRequestError &&
      error.status === 404
    ) {
      return null
    }
    if (options.throwOnFailure) {
      throw new Error(serverRequestFailureMessage(error), { cause: error })
    }
    return null
  }
}

export function bitbucketServerRepoApiPath(repo: BitbucketServerRepoRef): string {
  return `/rest/api/1.0/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.repoSlug)}`
}

async function normalizePullRequest(
  repo: BitbucketServerRepoRef,
  raw: RawBitbucketServerPullRequest
): Promise<BitbucketPullRequestInfo | null> {
  const headSha = bitbucketServerHeadSha(raw)
  const isOpen = mapBitbucketServerState(raw.state) === 'open'
  const [stats, merge] = await Promise.all([
    headSha
      ? requestJson<RawBitbucketServerBuildStats>(
          `/rest/build-status/1.0/commits/stats/${encodeURIComponent(headSha)}`
        )
      : null,
    // Why: merge checks are only meaningful, and only worth a request, for open PRs.
    isOpen && typeof raw.id === 'number'
      ? requestJson<RawBitbucketServerMerge>(
          `${bitbucketServerRepoApiPath(repo)}/pull-requests/${raw.id}/merge`
        )
      : null
  ])
  return mapBitbucketServerPullRequest(
    raw,
    deriveBitbucketServerBuildStatus(stats),
    deriveBitbucketServerMergeable(merge)
  )
}

async function repoRefFor(
  repoPath: string,
  connectionId: string | null | undefined,
  options: HostedReviewExecutionOptions
): Promise<BitbucketServerRepoRef | null> {
  return getBitbucketServerRepoRef(repoPath, connectionId, getHostedReviewLocalGitOptions(options))
}

export async function getBitbucketServerPullRequest(
  repoPath: string,
  prNumber: number,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPullRequestInfo | null> {
  const repo = await repoRefFor(repoPath, connectionId, options)
  if (!repo) {
    return null
  }
  const raw = await requestJson<RawBitbucketServerPullRequest>(
    `${bitbucketServerRepoApiPath(repo)}/pull-requests/${encodeURIComponent(String(prNumber))}`
  )
  return raw ? normalizePullRequest(repo, raw) : null
}

export async function getBitbucketServerPullRequestForBranch(
  repoPath: string,
  branch: string,
  linkedPRNumber?: number | null,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {},
  throwOnFailure = false
): Promise<BitbucketPullRequestInfo | null> {
  const branchName = branch.replace(/^refs\/heads\//, '')
  if (!branchName && linkedPRNumber == null) {
    return null
  }
  const repo = await repoRefFor(repoPath, connectionId, options)
  if (!repo) {
    return null
  }

  if (typeof linkedPRNumber === 'number') {
    const raw = await requestJson<RawBitbucketServerPullRequest>(
      `${bitbucketServerRepoApiPath(repo)}/pull-requests/${encodeURIComponent(String(linkedPRNumber))}`,
      { throwOnFailure, notFoundIsNull: true }
    )
    if (raw) {
      return normalizePullRequest(repo, raw)
    }
  }
  if (!branchName) {
    return null
  }

  const list = await requestJson<{ values?: RawBitbucketServerPullRequest[] }>(
    `${bitbucketServerRepoApiPath(repo)}/pull-requests`,
    {
      searchParams: {
        state: 'ALL',
        direction: 'OUTGOING',
        at: `refs/heads/${branchName}`,
        order: 'NEWEST',
        limit: '1'
      },
      throwOnFailure
    }
  )
  const raw = list?.values?.[0]
  if (!raw) {
    return null
  }
  const state = mapBitbucketServerState(raw.state)
  // Why: same rule as the Cloud client — a merged branch-only match is history and must not block a new PR.
  if (state === 'merged') {
    return null
  }
  const hideOnDefaultBranch = await shouldHideNonOpenReviewOnDefaultBranch({
    state,
    reviewNumber: raw.id ?? null,
    linkedReviewNumber: linkedPRNumber,
    branchName,
    repoPath,
    connectionId,
    localGitOptions: getHostedReviewLocalGitOptions(options)
  })
  return hideOnDefaultBranch ? null : normalizePullRequest(repo, raw)
}

export function getBitbucketServerPullRequestForBranchOrThrow(
  repoPath: string,
  branch: string,
  linkedPRNumber?: number | null,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPullRequestInfo | null> {
  return getBitbucketServerPullRequestForBranch(
    repoPath,
    branch,
    linkedPRNumber,
    connectionId,
    options,
    true
  )
}
