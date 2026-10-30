import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBitbucketServerPullRequests } from './server-pull-request-list'
import { _resetBitbucketServerRepoRefCache } from './server-repository-ref'

const execFileAsync = promisify(execFile)
const OLD_ENV = process.env

type RecordedRequest = { method: string; path: string }

async function withServerAndRepo(
  handler: (req: IncomingMessage, url: URL, res: ServerResponse) => void,
  run: (origin: string, repoPath: string, seen: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const seen: RecordedRequest[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    seen.push({ method: req.method ?? 'GET', path: url.pathname + url.search })
    handler(req, url, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const repoPath = await mkdtemp(join(tmpdir(), 'orca-bitbucket-server-list-'))
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

describe('listBitbucketServerPullRequests', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, ORCA_BITBUCKET_SERVER_TOKEN: 'server-token' }
    delete process.env.ORCA_BITBUCKET_SERVER_BASE_URL
    _resetBitbucketServerRepoRefCache()
  })

  afterEach(() => {
    process.env = OLD_ENV
    _resetBitbucketServerRepoRefCache()
  })

  it('lists open PRs and maps review decisions', async () => {
    await withServerAndRepo(
      (_req, url, res) => {
        if (url.pathname !== '/rest/api/1.0/projects/prj/repos/repo/pull-requests') {
          res.writeHead(404)
          res.end()
          return
        }
        sendJson(res, 200, {
          values: [
            {
              id: 12,
              title: 'Add feature',
              state: 'OPEN',
              updatedDate: 1_700_000_000_000,
              fromRef: { displayId: 'feature/x' },
              toRef: { displayId: 'main' },
              author: { name: 'alice', avatarUrl: 'https://avatar' },
              links: { self: [{ href: 'https://bb/pr/12' }] },
              reviewers: [{ user: { name: 'bob' }, status: 'NEEDS_WORK' }]
            },
            {
              id: 13,
              title: 'Draft thing',
              state: 'OPEN',
              draft: true,
              updatedDate: 1_700_000_001_000,
              fromRef: { displayId: 'draft/y' },
              toRef: { displayId: 'main' },
              author: { name: 'bob' },
              links: { self: [{ href: 'https://bb/pr/13' }] },
              reviewers: [{ user: { name: 'alice' }, status: 'APPROVED' }]
            }
          ],
          isLastPage: true
        })
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await listBitbucketServerPullRequests(repoPath, 'open', 'local')
        expect(result).toMatchObject({ ok: true })
        if (!result.ok) {
          return
        }
        expect(result.prs).toHaveLength(2)
        expect(result.prs[0]).toMatchObject({
          number: 12,
          title: 'Add feature',
          state: 'open',
          author: 'alice',
          branchName: 'feature/x',
          targetBranchName: 'main',
          reviewDecision: 'CHANGES_REQUESTED'
        })
        expect(result.prs[1]).toMatchObject({ isDraft: true, reviewDecision: 'APPROVED' })
        expect(seen[0]?.path).toBe(
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests?state=OPEN&limit=50&order=NEWEST'
        )
      }
    )
  })

  it('scopes mine and needs-review filters with the role parameter', async () => {
    await withServerAndRepo(
      (_req, url, res) => {
        if (url.pathname !== '/rest/api/1.0/projects/prj/repos/repo/pull-requests') {
          res.writeHead(404)
          res.end()
          return
        }
        sendJson(res, 200, { values: [], isLastPage: true })
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        await listBitbucketServerPullRequests(repoPath, 'mine', 'local')
        await listBitbucketServerPullRequests(repoPath, 'needs-review', 'local')
        expect(seen.map((r) => r.path)).toEqual([
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests?state=OPEN&limit=50&order=NEWEST&role=AUTHOR',
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests?state=OPEN&limit=50&order=NEWEST&role=REVIEWER'
        ])
      }
    )
  })

  it('fails fast without a credential', async () => {
    delete process.env.ORCA_BITBUCKET_SERVER_TOKEN
    const result = await listBitbucketServerPullRequests('/nonexistent', 'open', 'local')
    expect(result).toMatchObject({ ok: false })
  })
})
