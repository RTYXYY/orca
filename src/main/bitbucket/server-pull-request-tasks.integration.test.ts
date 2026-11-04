import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addBitbucketServerPRTask,
  getBitbucketServerPRTasks,
  setBitbucketServerPRTaskState
} from './server-pull-request-tasks'
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
  const repoPath = await mkdtemp(join(tmpdir(), 'orca-bitbucket-server-tasks-'))
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

const COMMENT_ID = 3
const PR_COMMENTS_PATH = `/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/comments`
const BLOCKER_COMMENTS_PATH = `/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/blocker-comments`

describe('Bitbucket Server PR tasks', () => {
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

  it('lists tasks from the blocker-comments endpoint', async () => {
    await withServerAndRepo(
      (_req, url, res) => {
        if (url.pathname === BLOCKER_COMMENTS_PATH) {
          sendJson(res, 200, {
            values: [
              {
                id: 3,
                text: 'Update the migration',
                state: 'OPEN',
                severity: 'BLOCKER',
                createdDate: 1_700_000_000_000,
                author: { name: 'jcitizen' }
              },
              { id: 4, text: 'Done already', state: 'RESOLVED', severity: 'BLOCKER' }
            ],
            isLastPage: true
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await getBitbucketServerPRTasks(repoPath, 12, 'local')
        expect(result).toEqual({
          ok: true,
          tasks: [
            {
              id: 3,
              text: 'Update the migration',
              state: 'OPEN',
              createdAt: new Date(1_700_000_000_000).toISOString(),
              author: 'jcitizen'
            },
            { id: 4, text: 'Done already', state: 'RESOLVED', createdAt: '', author: '' }
          ]
        })
      }
    )
  })

  it('creates a task as a BLOCKER comment', async () => {
    await withServerAndRepo(
      (_req, url, res, body) => {
        if (url.pathname === PR_COMMENTS_PATH) {
          const parsed = JSON.parse(body)
          sendJson(res, 201, {
            id: 9,
            text: parsed.text,
            state: 'OPEN',
            severity: 'BLOCKER',
            author: { name: 'jcitizen' }
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await addBitbucketServerPRTask(repoPath, 12, 'Add tests', 'local')
        expect(result).toMatchObject({ ok: true, task: { id: 9, state: 'OPEN' } })
        const post = seen.find((request) => request.method === 'POST')
        expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
          text: 'Add tests',
          severity: 'BLOCKER'
        })
      }
    )
  })

  it('resolves a task with the comment version as an optimistic lock', async () => {
    await withServerAndRepo(
      (req, url, res, body) => {
        if (url.pathname === `${PR_COMMENTS_PATH}/${COMMENT_ID}` && req.method === 'GET') {
          sendJson(res, 200, { id: COMMENT_ID, text: 'Task', state: 'OPEN', version: 5 })
          return
        }
        if (url.pathname === `${PR_COMMENTS_PATH}/${COMMENT_ID}` && req.method === 'PUT') {
          const parsed = JSON.parse(body)
          sendJson(res, 200, {
            id: COMMENT_ID,
            text: 'Task',
            state: parsed.state,
            severity: 'BLOCKER',
            version: 6
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await setBitbucketServerPRTaskState(
          repoPath,
          12,
          COMMENT_ID,
          'RESOLVED',
          'local'
        )
        expect(result).toMatchObject({ ok: true, task: { id: COMMENT_ID, state: 'RESOLVED' } })
        const put = seen.find((request) => request.method === 'PUT')
        expect(JSON.parse(put?.body ?? '{}')).toMatchObject({
          state: 'RESOLVED',
          severity: 'BLOCKER',
          version: 5
        })
      }
    )
  })

  it('fails fast without a credential', async () => {
    delete process.env.ORCA_BITBUCKET_SERVER_TOKEN
    await expect(getBitbucketServerPRTasks('/nonexistent', 12, 'local')).resolves.toMatchObject({
      ok: false
    })
  })
})
