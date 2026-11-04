import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBitbucketServerPRReviewStatus } from './server-pull-request-review-status'
import { _resetBitbucketServerRepoRefCache } from './server-repository-ref'
import { getHostedReviewForBranch } from '../source-control/hosted-review'
import { __resetHostedReviewBranchCacheForTests } from '../source-control/hosted-review-branch-cache'

const execFileAsync = promisify(execFile)
const OLD_ENV = process.env

type RecordedRequest = { method: string; path: string; body?: string }

/** Mutable server-side PR state the fake Data Center serves; mutations flip it like the real one. */
let participantStatus: string | null
let hadPriorReview = false

async function withServerAndRepo(
  handler: (req: IncomingMessage, url: URL, res: ServerResponse, body: string) => void,
  run: (origin: string, repoPath: string, seen: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const seen: RecordedRequest[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      seen.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body })
      handler(req, url, res, body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const repoPath = await mkdtemp(join(tmpdir(), 'orca-bitbucket-review-e2e-'))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP server address')
    }
    const origin = `http://127.0.0.1:${address.port}`
    await execFileAsync('git', ['init'], { cwd: repoPath })
    await execFileAsync('git', ['remote', 'add', 'origin', `${origin}/scm/prj/repo.git`], {
      cwd: repoPath
    })
    await run(origin, repoPath, seen)
  } finally {
    await rm(repoPath, { recursive: true, force: true })
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function fakeServerHandler(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  body: string
): void {
  if (url.pathname === '/rest/api/1.0/users') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-AUSERNAME': 'jcitizen' })
    res.end(JSON.stringify({ values: [] }))
    return
  }
  if (
    url.pathname ===
      '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/participants/jcitizen' &&
    req.method === 'PUT'
  ) {
    participantStatus = JSON.parse(body).status
    hadPriorReview = true
    sendJson(res, 200, { user: { name: 'jcitizen' }, status: participantStatus })
    return
  }
  if (url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests') {
    // Why: mirrors real DC — PUT keeps the reviewer entry carrying the new status.
    const reviewers = hadPriorReview
      ? [{ user: { name: 'jcitizen' }, status: participantStatus ?? 'UNAPPROVED' }]
      : []
    sendJson(res, 200, {
      size: 1,
      values: [
        {
          id: 12,
          title: 'End-to-end review status',
          state: 'OPEN',
          updatedDate: 1792460776769,
          fromRef: { id: 'refs/heads/feat', displayId: 'feat', latestCommit: 'abc123' },
          toRef: { id: 'refs/heads/main', displayId: 'main', latestCommit: 'def456' },
          reviewers,
          links: { self: [{ href: 'https://bitbucket.example.com/pr/12' }] }
        }
      ]
    })
    return
  }
  if (url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/merge') {
    sendJson(res, 200, { canMerge: true, conflicted: false, outcome: 'CLEAN', vetoes: [] })
    return
  }
  if (url.pathname === '/rest/build-status/1.0/commits/stats/abc123') {
    sendJson(res, 200, { successful: 1, inProgress: 0, failed: 0 })
    return
  }
  res.writeHead(404)
  res.end()
}

function resetCaches(): void {
  _resetBitbucketServerRepoRefCache()
  __resetHostedReviewBranchCacheForTests()
  participantStatus = null
  hadPriorReview = false
}

async function reviewDecisionForBranch(repoPath: string): Promise<string | null | undefined> {
  const review = await getHostedReviewForBranch({
    executionHostId: 'local',
    repoPath,
    branch: 'refs/heads/feat'
  })
  return review?.reviewDecision
}

describe('Bitbucket review status end-to-end (mutation → cache invalidation → refresh)', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, ORCA_BITBUCKET_SERVER_TOKEN: 'server-token' }
    delete process.env.ORCA_BITBUCKET_SERVER_BASE_URL
    resetCaches()
    participantStatus = null
  })

  afterEach(() => {
    process.env = OLD_ENV
    resetCaches()
  })

  it(
    'approve → shows APPROVED, needs work → shows CHANGES_REQUESTED, unapprove → back to REVIEW_REQUIRED',
    { timeout: 30_000 },
    async () => {
      await withServerAndRepo(fakeServerHandler, async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin

        // Initial read: no review yet — both arrays empty yields null (button shows Approve).
        expect(await reviewDecisionForBranch(repoPath)).toBeNull()

        // Approve, then force-refresh like refreshHostedReviewCard does.
        await expect(
          setBitbucketServerPRReviewStatus(repoPath, 12, 'APPROVED', 'local')
        ).resolves.toEqual({ ok: true, status: 'APPROVED' })
        expect(
          await getHostedReviewForBranch({
            executionHostId: 'local',
            repoPath,
            branch: 'refs/heads/feat',
            force: true
          })
        ).toMatchObject({ reviewDecision: 'APPROVED' })

        // Needs work replaces the approval.
        await expect(
          setBitbucketServerPRReviewStatus(repoPath, 12, 'NEEDS_WORK', 'local')
        ).resolves.toEqual({ ok: true, status: 'NEEDS_WORK' })
        expect(
          await getHostedReviewForBranch({
            executionHostId: 'local',
            repoPath,
            branch: 'refs/heads/feat',
            force: true
          })
        ).toMatchObject({ reviewDecision: 'CHANGES_REQUESTED' })

        // Undo approve (DELETE participation) drops back to review required.
        await expect(
          setBitbucketServerPRReviewStatus(repoPath, 12, 'UNAPPROVED', 'local')
        ).resolves.toEqual({ ok: true, status: 'UNAPPROVED' })
        expect(
          await getHostedReviewForBranch({
            executionHostId: 'local',
            repoPath,
            branch: 'refs/heads/feat',
            force: true
          })
        ).toMatchObject({ reviewDecision: 'REVIEW_REQUIRED' })

        // The PUTs actually hit the fake server; unapprove is PUT UNAPPROVED, not DELETE (keeps reviewer role).
        const mutations = seen.filter((request) => request.path.includes('/participants/jcitizen'))
        expect(mutations.map((request) => request.method)).toEqual(['PUT', 'PUT', 'PUT'])
        expect(JSON.parse(mutations[0]?.body ?? '{}')).toMatchObject({ status: 'APPROVED' })
        expect(JSON.parse(mutations[1]?.body ?? '{}')).toMatchObject({ status: 'NEEDS_WORK' })
        expect(JSON.parse(mutations[2]?.body ?? '{}')).toMatchObject({ status: 'UNAPPROVED' })
      })
    }
  )

  it(
    'a stale non-forced read after approval cannot defeat the mutation refresh (cache invalidated)',
    { timeout: 30_000 },
    async () => {
      await withServerAndRepo(fakeServerHandler, async (origin, repoPath) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin

        // Prime the cache with the pre-approval answer (no review yet).
        expect(await reviewDecisionForBranch(repoPath)).toBeNull()

        await setBitbucketServerPRReviewStatus(repoPath, 12, 'APPROVED', 'local')

        // Even without force, the invalidated cache must not serve the stale REVIEW_REQUIRED.
        expect(await reviewDecisionForBranch(repoPath)).toBe('APPROVED')
      })
    }
  )
})
