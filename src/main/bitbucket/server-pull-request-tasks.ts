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

// Why: DC 8.0 removed /tasks; tasks are comments with severity BLOCKER (blocker comments since 7.2).
const TASK_TIMEOUT_MS = 30_000
const TASKS_PAGE_LIMIT = 100
const MAX_TASK_PAGES = 25

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

type RawTaskComment = {
  id?: number
  text?: string
  createdDate?: number
  state?: string
  severity?: string
  author?: { name?: string; displayName?: string }
  version?: number
}

type RawTaskCommentPage = {
  values?: RawTaskComment[]
  isLastPage?: boolean
  nextPageStart?: number | null
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function mapTaskComment(raw: RawTaskComment): BitbucketPRTask | null {
  const id = numberOrUndefined(raw.id)
  const text = stringOf(raw.text)
  if (id === undefined || !text) {
    return null
  }
  const createdMs = numberOrUndefined(raw.createdDate)
  return {
    id,
    text,
    state: stringOf(raw.state)?.toUpperCase() === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
    createdAt: createdMs !== undefined ? new Date(createdMs).toISOString() : '',
    author: stringOf(raw.author?.name) ?? stringOf(raw.author?.displayName) ?? ''
  }
}

function failureReason(error: unknown, fallback: string): string {
  const reason = error instanceof HostedReviewApiRequestError ? serverErrorMessage(error) : ''
  return reason || (error instanceof Error ? error.message : fallback)
}

type ResolvedContext = { baseUrl: string; repoApiPath: string } | { error: string }

async function resolveRepoApiPath(
  repoPath: string,
  executionHostId: ExecutionHostId,
  connectionId: string | null | undefined,
  options: HostedReviewExecutionOptions,
  unavailableError: string
): Promise<ResolvedContext> {
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return {
      error:
        'Bitbucket Data Center is not connected. Connect it in Settings > Integrations to load pull request tasks.'
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

export async function getBitbucketServerPRTasks(
  repoPath: string,
  prNumber: number,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketPRTasksResult> {
  const resolved = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Pull request tasks require a Bitbucket Data Center remote.'
  )
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  const values: RawTaskComment[] = []
  let start = 0
  try {
    for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
      const url = new URL(
        `${resolved.baseUrl}${resolved.repoApiPath}/pull-requests/${encodeURIComponent(
          String(prNumber)
        )}/blocker-comments`
      )
      url.searchParams.set('start', String(start))
      url.searchParams.set('limit', String(TASKS_PAGE_LIMIT))
      // SAFETY: DC returns a JSON page object; fields are validated in mapTaskComment.
      const body = await requestHostedReviewJson<RawTaskCommentPage>(
        url,
        {
          headers: {
            Accept: 'application/json',
            ...serverAuthHeaders(resolveBitbucketServerAuthConfig())
          }
        },
        TASK_TIMEOUT_MS
      )
      values.push(...(body.values ?? []))
      if (body.isLastPage !== false || body.nextPageStart == null) {
        break
      }
      start = body.nextPageStart
    }
    const tasks = values
      .map(mapTaskComment)
      .filter((task): task is BitbucketPRTask => task !== null)
    return { ok: true, tasks }
  } catch (error) {
    return {
      ok: false,
      error: `Could not load pull request tasks: ${failureReason(error, 'request failed')}`
    }
  }
}

export async function addBitbucketServerPRTask(
  repoPath: string,
  prNumber: number,
  text: string,
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketAddPRTaskResult> {
  const resolved = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Creating a task requires a Bitbucket Data Center remote.'
  )
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  const url = new URL(
    `${resolved.baseUrl}${resolved.repoApiPath}/pull-requests/${encodeURIComponent(
      String(prNumber)
    )}/comments`
  )
  try {
    // SAFETY: DC returns the created comment; mapTaskComment validates fields.
    const raw = await requestHostedReviewJson<RawTaskComment>(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...serverAuthHeaders(resolveBitbucketServerAuthConfig())
        },
        body: JSON.stringify({ text, severity: 'BLOCKER' })
      },
      TASK_TIMEOUT_MS
    )
    const task = mapTaskComment(raw)
    if (!task) {
      return { ok: false, error: 'Bitbucket Data Center returned an unreadable task.' }
    }
    return { ok: true, task }
  } catch (error) {
    return {
      ok: false,
      error: `Could not create the task: ${failureReason(error, 'request failed')}`
    }
  }
}

async function getTaskCommentVersion(
  baseUrl: string,
  repoApiPath: string,
  prNumber: number,
  taskId: number
): Promise<number | null> {
  try {
    const url = new URL(
      `${baseUrl}${repoApiPath}/pull-requests/${encodeURIComponent(String(prNumber))}/comments/${encodeURIComponent(String(taskId))}`
    )
    const raw = await requestHostedReviewJson<RawTaskComment>(
      url,
      {
        headers: {
          Accept: 'application/json',
          ...serverAuthHeaders(resolveBitbucketServerAuthConfig())
        }
      },
      TASK_TIMEOUT_MS
    )
    return numberOrUndefined(raw.version) ?? null
  } catch {
    return null
  }
}

export async function setBitbucketServerPRTaskState(
  repoPath: string,
  prNumber: number,
  taskId: number,
  state: 'OPEN' | 'RESOLVED',
  executionHostId: ExecutionHostId,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<BitbucketSetPRTaskStateResult> {
  const resolved = await resolveRepoApiPath(
    repoPath,
    executionHostId,
    connectionId,
    options,
    'Updating a task requires a Bitbucket Data Center remote.'
  )
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  // Why: the comment PUT requires the current version as an optimistic lock, mirroring merge.
  const version = await getTaskCommentVersion(
    resolved.baseUrl,
    resolved.repoApiPath,
    prNumber,
    taskId
  )
  if (version === null) {
    return {
      ok: false,
      error: 'Could not read the task version. Refresh the pull request and try again.'
    }
  }
  const url = new URL(
    `${resolved.baseUrl}${resolved.repoApiPath}/pull-requests/${encodeURIComponent(
      String(prNumber)
    )}/comments/${encodeURIComponent(String(taskId))}`
  )
  try {
    // SAFETY: DC returns the updated comment; mapTaskComment validates fields.
    const raw = await requestHostedReviewJson<RawTaskComment>(
      url,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...serverAuthHeaders(resolveBitbucketServerAuthConfig())
        },
        body: JSON.stringify({ state, severity: 'BLOCKER', version })
      },
      TASK_TIMEOUT_MS
    )
    const task = mapTaskComment(raw)
    if (!task) {
      return { ok: false, error: 'Bitbucket Data Center returned an unreadable task.' }
    }
    return { ok: true, task }
  } catch (error) {
    return {
      ok: false,
      error: `Could not update the task: ${failureReason(error, 'request failed')}`
    }
  }
}
