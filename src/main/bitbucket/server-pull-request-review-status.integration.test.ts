import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBitbucketServerPRReviewStatus } from './server-pull-request-review-status'
import { _resetBitbucketServerRepoRefCache } from './server-repository-ref'

const execFileAsync = promisify(execFile)
const OLD_ENV = process.env

type RecordedRequest = { method: string; path: string; body?: string }

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
  const repoPath = await mkdtemp(join(tmpdir(), 'orca-bitbucket-server-status-'))
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

describe('setBitbucketServerPRReviewStatus', () => {
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      ORCA_BITBUCKET_SERVER_TOKEN: 'server-token',
      ORCA_BITBUCKET_SERVER_BASE_URL: 'http://127.0.0.1:1'
    }
    _resetBitbucketServerRepoRefCache()
  })

  afterEach(() => {
    process.env = OLD_ENV
    _resetBitbucketServerRepoRefCache()
  })

  it('PUTs the status for the X-AUSERNAME slug', async () => {
    await withServerAndRepo(
      (req, url, res, _body) => {
        if (url.pathname === '/rest/api/1.0/users') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-AUSERNAME': 'jcitizen'
          })
          res.end(JSON.stringify({ values: [] }))
          return
        }
        if (
          url.pathname ===
            '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/participants/jcitizen' &&
          req.method === 'PUT'
        ) {
          sendJson(res, 200, { user: { name: 'jcitizen' }, status: 'APPROVED' })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        await expect(
          setBitbucketServerPRReviewStatus(repoPath, 12, 'APPROVED', 'local')
        ).resolves.toEqual({ ok: true, status: 'APPROVED' })
        const put = seen.find(
          (request) =>
            request.method === 'PUT' &&
            request.path ===
              '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/participants/jcitizen'
        )
        expect(put).toBeDefined()
        expect(JSON.parse(put?.body ?? '{}')).toMatchObject({ status: 'APPROVED' })
      }
    )
  })

  it('reports the author restriction as a 400 without a server message', async () => {
    await withServerAndRepo(
      (_req, url, res) => {
        if (url.pathname === '/rest/api/1.0/users') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-AUSERNAME': 'author'
          })
          res.end(JSON.stringify({ values: [] }))
          return
        }
        sendJson(res, 400, { errors: [] })
      },
      async (origin, repoPath) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await setBitbucketServerPRReviewStatus(repoPath, 12, 'NEEDS_WORK', 'local')
        expect(result).toMatchObject({ ok: false, code: 'author' })
      }
    )
  })

  it('fails fast without a credential', async () => {
    delete process.env.ORCA_BITBUCKET_SERVER_TOKEN
    const result = await setBitbucketServerPRReviewStatus('/nonexistent', 12, 'APPROVED', 'local')
    expect(result).toMatchObject({ ok: false, code: 'auth_required' })
  })
})
