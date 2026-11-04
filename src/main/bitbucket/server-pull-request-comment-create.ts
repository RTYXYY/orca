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
import {
  mapBitbucketServerComment,
  type RawBitbucketServerComment
} from './server-pull-request-comments'
import { serverErrorMessage } from './server-request-errors'
import { getBitbucketServerRepoRef } from './server-repository-ref'

const COMMENT_POST_TIMEOUT_MS = 30_000

export type BitbucketAddCommentResult =
  | { ok: true; comment: PRComment }
  | { ok: false; error: string }

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function failureReason(error: unknown): string {
  const reason = error instanceof HostedReviewApiRequestError ? serverErrorMessage(error) : ''
  return reason || (error instanceof Error ? error.message : 'request failed')
}

async function resolveRepoApiPath(
  repoPath: string,
  executionHostId: ExecutionHostId,
  connectionId: string | null | undefined,
  options: HostedReviewExecutionOptions,
  unavailableError: string
): Promise<{ baseUrl: string; repoApiPath: string } | { error: string }> {
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return {
      error: 'Bitbucket Data Center is not connected. Connect it in Settings > Integrations first.'
    }
  }
  const repo = await getBitbucketServerRepoRef(
    repoPath,
    connectionId ?? hostedReviewSshConnectionId(executionHostId),
    getHostedReviewLocalGitOptions(options)
  )
  if (!repo) {
    return { error: unavailableError }
  }
  return { baseUrl: config.baseUrl, repoApiPath: bitbucketServerRepoApiPath(repo) }
}

async function postComment(
  baseUrl: string,
  repoApiPath: string,
  prNumber: number,
  payload: Record<string, unknown>
): Promise<BitbucketAddCommentResult> {
  const url = new URL(
    `${baseUrl}${repoApiPath}/pull-requests/${encodeURIComponent(String(prNumber))}/comments`
  )
  try {
    const config = resolveBitbucketServerAuthConfig()
    // SAFETY: DC returns the created comment as JSON; mapBitbucketServerComment validates fields.
    const raw = await requestHostedReviewJson<RawBitbucketServerComment>(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...serverAuthHeaders(config)
        },
        body: JSON.stringify(payload)
      },
      COMMENT_POST_TIMEOUT_MS
    )
    const mapped = mapBitbucketServerComment(raw, numberOrUndefined(raw.id) ?? 0)
    if (!mapped) {
      return { ok: false, error: 'Bitbucket Data Center returned an unreadable comment.' }
    }
    return { ok: true, comment: mapped }
  } catch (error) {
    return { ok: false, error: `Could not post the comment: ${failureReason(error)}` }
  }
}

async function postTopLevelComment(
  repoPath: string,
  prNumber: number,
  body: string,
  executionHostId: ExecutionHostId,
  connectionId: string | null | undefined,
  options: HostedReviewExecutionOptions
): Promise<BitbucketAddCommentResult> {
  const resolved = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Commenting requires a Bitbucket Data Center remote.'
  )
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  return postComment(resolved.baseUrl, resolved.repoApiPath, prNumber, { text: body })
}

export async function addBitbucketServerPRComment(
  repoPath: string,
  prNumber: number,
  body: string,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketAddCommentResult> {
  return postTopLevelComment(repoPath, prNumber, body, executionHostId, connectionId, options)
}

export async function replyToBitbucketServerPRComment(
  repoPath: string,
  prNumber: number,
  parentCommentId: number,
  body: string,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketAddCommentResult> {
  const resolved = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Replying requires a Bitbucket Data Center remote.'
  )
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  return postComment(resolved.baseUrl, resolved.repoApiPath, prNumber, {
    text: body,
    parent: { id: parentCommentId }
  })
}

export async function addBitbucketServerPRLineComment(
  repoPath: string,
  prNumber: number,
  args: {
    path: string
    line: number
    body: string
    srcPath?: string
    lineType?: string
    fromHash?: string
    toHash?: string
  },
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketAddCommentResult> {
  const resolved = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Commenting requires a Bitbucket Data Center remote.'
  )
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  return postComment(resolved.baseUrl, resolved.repoApiPath, prNumber, {
    text: args.body,
    anchor: {
      path: args.path,
      line: args.line,
      lineType: args.lineType ?? 'ADDED',
      fileType: 'TO',
      ...(args.srcPath ? { srcPath: args.srcPath } : {}),
      fromHash: args.fromHash ?? '',
      toHash: args.toHash ?? ''
    }
  })
}

export type BitbucketResolveCommentResult = { ok: true } | { ok: false; error?: string }

/**
 * Resolve a comment thread. DC marks resolution on the thread-root comment via
 * GET (for the optimistic-lock version) + PUT with resolved=true.
 */
export async function resolveBitbucketServerPRCommentThread(
  repoPath: string,
  prNumber: number,
  threadRootCommentId: number,
  resolved: boolean,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketResolveCommentResult> {
  const resolvedPath = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Resolving a comment requires a Bitbucket Data Center remote.'
  )
  if ('error' in resolvedPath) {
    return { ok: false, error: resolvedPath.error }
  }
  const commentUrl = (suffix = '') =>
    new URL(
      `${resolvedPath.baseUrl}${resolvedPath.repoApiPath}/pull-requests/${encodeURIComponent(
        String(prNumber)
      )}/comments/${encodeURIComponent(String(threadRootCommentId))}${suffix}`
    )
  try {
    // SAFETY: DC returns the current comment; only scalar fields are read.
    const current = await requestHostedReviewJson<RawBitbucketServerComment>(
      commentUrl(),
      {
        headers: {
          Accept: 'application/json',
          ...serverAuthHeaders(resolveBitbucketServerAuthConfig())
        }
      },
      COMMENT_POST_TIMEOUT_MS
    )
    const version = numberOrUndefined(current.version)
    if (version === undefined) {
      return { ok: false, error: 'Could not read the comment version to resolve it.' }
    }
    await requestHostedReviewJson(
      commentUrl(),
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...serverAuthHeaders(resolveBitbucketServerAuthConfig())
        },
        // Why: DC 8+ transitions comment state (RESOLVED/OPEN); a boolean resolved field is ignored.
        body: JSON.stringify({
          text: stringOf(current.text) ?? '',
          version,
          severity: stringOf(current.severity) ?? 'NORMAL',
          state: resolved ? 'RESOLVED' : 'OPEN'
        })
      },
      COMMENT_POST_TIMEOUT_MS
    )
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: failureReason(error)
    }
  }
}
