import type { ExecutionHostId } from '../../shared/execution-host'
import type { PRComment } from '../../shared/github/comment-types'
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

const COMMENTS_TIMEOUT_MS = 30_000
const COMMENTS_PAGE_LIMIT = 100
const MAX_COMMENT_PAGES = 50

export type RawBitbucketServerCommentAnchor = {
  path?: string
  srcPath?: string
  line?: number
  lineType?: string
  fileType?: string
  orphaned?: boolean
}

export type RawBitbucketServerComment = {
  id?: number
  text?: string
  createdDate?: number
  updatedDate?: number
  version?: number
  resolved?: boolean
  severity?: string
  author?: { name?: string; displayName?: string; emailAddress?: string; avatarUrl?: string }
  parent?: { id?: number } | number
  anchor?: RawBitbucketServerCommentAnchor
  links?: { self?: readonly { href?: string }[] }
}

export type RawBitbucketServerCommentPage = {
  values?: RawBitbucketServerComment[]
  isLastPage?: boolean
  nextPageStart?: number | null
}

export type BitbucketPRCommentResult =
  | { ok: true; comments: PRComment[] }
  | { ok: false; error: string }

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parentIdOf(raw: RawBitbucketServerComment): number | undefined {
  if (typeof raw.parent === 'number') {
    return raw.parent
  }
  return numberOrUndefined(raw.parent?.id)
}

export function mapBitbucketServerComment(
  raw: RawBitbucketServerComment,
  threadRootId: number
): PRComment | null {
  const id = numberOrUndefined(raw.id)
  const body = stringOf(raw.text)
  if (id === undefined || !body) {
    return null
  }
  const createdMs = numberOrUndefined(raw.createdDate)
  const anchor = raw.anchor
  // Why: only anchors on the new file side can render inline; removed-side and orphaned anchors cannot be placed.
  const hasLiveAnchor =
    anchor !== undefined &&
    stringOf(anchor.path) !== undefined &&
    stringOf(anchor.lineType) !== 'REMOVED' &&
    anchor.orphaned !== true
  return {
    id,
    author: stringOf(raw.author?.name) ?? stringOf(raw.author?.displayName) ?? '',
    authorAvatarUrl: stringOf(raw.author?.avatarUrl) ?? '',
    body,
    createdAt: createdMs !== undefined ? new Date(createdMs).toISOString() : '',
    url: stringOf(raw.links?.self?.[0]?.href) ?? '',
    ...(hasLiveAnchor
      ? {
          path: stringOf(anchor?.path),
          line: numberOrUndefined(anchor?.line),
          // Why: orphaned anchors no longer map onto the current diff, matching GitHub's outdated threads.
          isOutdated: false
        }
      : {}),
    threadId: String(threadRootId),
    ...(raw.resolved === true ? { isResolved: true } : {})
  }
}

/** Rebuilds DC's parent chains into flat threads anchored at the root comment id. */
export function mapBitbucketServerComments(
  raws: readonly RawBitbucketServerComment[]
): PRComment[] {
  const byId = new Map<number, RawBitbucketServerComment>()
  for (const raw of raws) {
    const id = numberOrUndefined(raw.id)
    if (id !== undefined) {
      byId.set(id, raw)
    }
  }
  const comments: PRComment[] = []
  for (const raw of raws) {
    // Why: walk the parent chain to the root; replies inherit the root's id as their thread id.
    let current = raw
    let guard = 0
    while (guard < 100) {
      const parent = parentIdOf(current)
      const parentRaw = parent !== undefined ? byId.get(parent) : undefined
      if (!parentRaw) {
        break
      }
      current = parentRaw
      guard += 1
    }
    const threadRoot = numberOrUndefined(current.id) ?? numberOrUndefined(raw.id) ?? 0
    const mapped = mapBitbucketServerComment(raw, threadRoot)
    if (mapped) {
      comments.push(mapped)
    }
  }
  return comments
}

async function fetchAllCommentPages(
  config: ReturnType<typeof resolveBitbucketServerAuthConfig>,
  repoApiPath: string,
  prNumber: number
): Promise<RawBitbucketServerComment[]> {
  const values: RawBitbucketServerComment[] = []
  let start = 0
  for (let page = 0; page < MAX_COMMENT_PAGES; page += 1) {
    const url = new URL(
      `${config.baseUrl}${repoApiPath}/pull-requests/${encodeURIComponent(String(prNumber))}/comments`
    )
    url.searchParams.set('start', String(start))
    url.searchParams.set('limit', String(COMMENTS_PAGE_LIMIT))
    // SAFETY: DC returns a JSON object matching RawBitbucketServerCommentPage; fields are validated in the mappers.
    const body = await requestHostedReviewJson<RawBitbucketServerCommentPage>(
      url,
      {
        headers: { Accept: 'application/json', ...serverAuthHeaders(config) }
      },
      COMMENTS_TIMEOUT_MS
    )
    values.push(...(body.values ?? []))
    if (body.isLastPage !== false || body.nextPageStart == null) {
      break
    }
    start = body.nextPageStart
  }
  return values
}

export async function getBitbucketServerPRComments(
  repoPath: string,
  prNumber: number,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPRCommentResult> {
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return {
      ok: false,
      error:
        'Bitbucket Data Center is not connected. Connect it in Settings > Integrations to load pull request comments.'
    }
  }
  const repo = await getBitbucketServerRepoRef(
    repoPath,
    connectionId ?? hostedReviewSshConnectionId(executionHostId),
    getHostedReviewLocalGitOptions(options)
  )
  if (!repo) {
    return { ok: false, error: 'Pull request comments require a Bitbucket Data Center remote.' }
  }
  try {
    const raws = await fetchAllCommentPages(config, bitbucketServerRepoApiPath(repo), prNumber)
    return { ok: true, comments: mapBitbucketServerComments(raws) }
  } catch (error) {
    return {
      ok: false,
      error: `Could not load pull request comments: ${serverErrorMessageOrStatus(error)}`
    }
  }
}

function serverErrorMessageOrStatus(error: unknown): string {
  const reason = error instanceof HostedReviewApiRequestError ? serverErrorMessage(error) : ''
  return reason || (error instanceof Error ? error.message : 'request failed')
}

export type BitbucketAddCommentResult =
  | { ok: true; comment: PRComment }
  | { ok: false; error: string }
