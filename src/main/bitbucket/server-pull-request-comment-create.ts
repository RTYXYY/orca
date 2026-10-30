import type { ExecutionHostId } from '../../shared/execution-host'
import type { PRComment } from '../../shared/github/comment-types'
import { requestHostedReviewJson } from '../source-control/hosted-review-api-request'
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
import { HostedReviewApiRequestError } from '../source-control/hosted-review-api-request'
import { getBitbucketServerRepoRef } from './server-repository-ref'

const COMMENT_POST_TIMEOUT_MS = 30_000

export type BitbucketAddCommentResult =
  | { ok: true; comment: PRComment }
  | { ok: false; error: string }

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
    const raw = (await requestHostedReviewJson(
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
    )) as RawBitbucketServerComment
    const mapped = mapBitbucketServerComment(raw, numberOrUndefined(raw.id) ?? 0)
    if (!mapped) {
      return { ok: false, error: 'Bitbucket Data Center returned an unreadable comment.' }
    }
    return { ok: true, comment: mapped }
  } catch (error) {
    return { ok: false, error: `Could not post the comment: ${failureReason(error)}` }
  }
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
