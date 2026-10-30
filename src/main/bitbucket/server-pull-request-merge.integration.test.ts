import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mergeBitbucketServerPullRequest } from './server-pull-request-merge'
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
  const repoPath = await mkdtemp(join(tmpdir(), 'orca-bitbucket-server-merge-'))
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

describe('mergeBitbucketServerPullRequest', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, ORCA_BITBUCKET_SERVER_TOKEN: 'server-token' }
    delete process.env.ORCA_BITBUCKET_SERVER_BASE_URL
    _resetBitbucketServerRepoRefCache()
  })

  afterEach(() => {
    process.env = OLD_ENV
    _resetBitbucketServerRepoRefCache()
  })

  it('POSTs the merge with the current PR version', async () => {
    await withServerAndRepo(
      (req, url, res) => {
        if (
          url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12' &&
          req.method === 'GET'
        ) {
          sendJson(res, 200, { id: 12, version: 7, state: 'OPEN' })
          return
        }
        if (
          url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/merge' &&
          req.method === 'POST'
        ) {
          sendJson(res, 200, { canMerge: true, outcome: 'CLEAN' })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        await expect(mergeBitbucketServerPullRequest(repoPath, 12, 'local')).resolves.toEqual({
          ok: true
        })
        expect(seen).toContainEqual({
          method: 'POST',
          path: '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/merge?version=7'
        })
      }
    )
  })

  it('reports a server rejection reason from the error body', async () => {
    await withServerAndRepo(
      (_req, url, res) => {
        if (url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12') {
          sendJson(res, 200, { id: 12, version: 7, state: 'OPEN' })
          return
        }
        sendJson(res, 409, {
          errors: [{ message: 'The pull request is not mergeable' }]
        })
      },
      async (origin, repoPath) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await mergeBitbucketServerPullRequest(repoPath, 12, 'local')
        expect(result).toEqual({
          ok: false,
          code: 'conflict',
          error:
            'Merge failed: the pull request changed on the server (new commits or version conflict). Refresh and try again.'
        })
      }
    )
  })

  it('fails fast without a credential', async () => {
    delete process.env.ORCA_BITBUCKET_SERVER_TOKEN
    const result = await mergeBitbucketServerPullRequest('/nonexistent', 12, 'local')
    expect(result).toMatchObject({ ok: false, code: 'auth_required' })
  })
})
