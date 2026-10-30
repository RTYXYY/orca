import type { ExecutionHostId } from '../../shared/execution-host'
import type { PRReviewDecision } from '../../shared/github/pull-request-types'
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
import { getBitbucketServerRepoRef } from './server-repository-ref'

const LIST_TIMEOUT_MS = 30_000
const LIST_PAGE_LIMIT = 50

export type BitbucketPRListFilter = 'open' | 'mine' | 'needs-review'

export type BitbucketServerPRSummary = {
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
  reviewDecision: PRReviewDecision | null
  isMergeable: boolean
}

export type BitbucketPRListResult =
  | { ok: true; prs: BitbucketServerPRSummary[] }
  | { ok: false; error: string }

type RawListResponse = {
  values?: RawListItem[]
  isLastPage?: boolean
  nextPageStart?: number | null
}

type RawListItem = {
  id?: number
  title?: string
  state?: string | null
  draft?: boolean
  open?: boolean
  updatedDate?: number
  closed?: boolean
  locked?: boolean
  fromRef?: { displayId?: string; latestCommit?: string }
  toRef?: { displayId?: string }
  author?: { name?: string; displayName?: string; avatarUrl?: string }
  links?: { self?: readonly { href?: string }[] }
  reviewers?: readonly { user?: { name?: string }; status?: string }[]
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function mapState(raw: RawListItem): BitbucketServerPRSummary['state'] {
  if (raw.draft === true) {
    return 'draft'
  }
  const normalized = stringOf(raw.state)?.trim().toUpperCase()
  if (normalized === 'MERGED') {
    return 'merged'
  }
  if (normalized === 'DECLINED') {
    return 'closed'
  }
  return 'open'
}

function mapReviewDecision(reviewers: RawListItem['reviewers']): PRReviewDecision | null {
  if (!reviewers || reviewers.length === 0) {
    return null
  }
  const statuses = reviewers.map((reviewer) => stringOf(reviewer.status)?.toUpperCase())
  if (statuses.includes('NEEDS_WORK')) {
    return 'CHANGES_REQUESTED'
  }
  return statuses.includes('APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED'
}

function mapSummary(raw: RawListItem): BitbucketServerPRSummary | null {
  const number = raw.id
  const title = stringOf(raw.title)
  const url = stringOf(raw.links?.self?.[0]?.href)
  if (typeof number !== 'number' || !title || !url) {
    return null
  }
  const updatedMs = raw.updatedDate
  return {
    number,
    title,
    state: mapState(raw),
    url,
    author: stringOf(raw.author?.name) ?? stringOf(raw.author?.displayName) ?? '',
    authorAvatarUrl: stringOf(raw.author?.avatarUrl) ?? '',
    branchName: stringOf(raw.fromRef?.displayId) ?? '',
    targetBranchName: stringOf(raw.toRef?.displayId) ?? '',
    updatedAt: typeof updatedMs === 'number' ? new Date(updatedMs).toISOString() : '',
    isDraft: raw.draft === true,
    reviewDecision: mapReviewDecision(raw.reviewers),
    isMergeable: false
  }
}

export async function listBitbucketServerPullRequests(
  repoPath: string,
  filter: BitbucketPRListFilter,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPRListResult> {
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return {
      ok: false,
      error:
        'Bitbucket Data Center is not connected. Connect it in Settings > Integrations to list pull requests.'
    }
  }
  const repo = await getBitbucketServerRepoRef(
    repoPath,
    connectionId ?? hostedReviewSshConnectionId(executionHostId),
    getHostedReviewLocalGitOptions(options)
  )
  if (!repo) {
    return { ok: false, error: 'Listing pull requests requires a Bitbucket Data Center remote.' }
  }
  // Why: DC's role parameter scopes server-side: AUTHOR for mine, REVIEWER for needs-review.
  const roleByFilter: Record<BitbucketPRListFilter, string | undefined> = {
    open: undefined,
    mine: 'AUTHOR',
    'needs-review': 'REVIEWER'
  }
  const url = new URL(`${config.baseUrl}${bitbucketServerRepoApiPath(repo)}/pull-requests`)
  url.searchParams.set('state', 'OPEN')
  url.searchParams.set('limit', String(LIST_PAGE_LIMIT))
  url.searchParams.set('order', 'NEWEST')
  const role = roleByFilter[filter]
  if (role) {
    url.searchParams.set('role', role)
  }
  try {
    // SAFETY: DC returns a paged JSON object; each item is validated in mapSummary.
    const body = await requestHostedReviewJson<RawListResponse>(
      url,
      {
        headers: { Accept: 'application/json', ...serverAuthHeaders(config) }
      },
      LIST_TIMEOUT_MS
    )
    const prs = (body.values ?? [])
      .map(mapSummary)
      .filter((pr): pr is BitbucketServerPRSummary => pr !== null)
    return { ok: true, prs }
  } catch (error) {
    const reason =
      error instanceof HostedReviewApiRequestError && error.status
        ? `HTTP ${error.status}`
        : error instanceof Error
          ? error.message
          : 'request failed'
    return { ok: false, error: `Could not list pull requests: ${reason}` }
  }
}
