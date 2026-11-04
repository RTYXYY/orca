import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addBitbucketServerPRLineComment,
  replyToBitbucketServerPRComment
} from './server-pull-request-comment-create'
import { getBitbucketServerPRComments } from './server-pull-request-comments'
import { _resetBitbucketServerRepoRefCache } from './server-repository-ref'

const execFileAsync = promisify(execFile)
const OLD_ENV = process.env

type RecordedRequest = { method: string; path: string; body?: unknown }

async function withServerAndRepo(
  handler: (req: IncomingMessage, url: URL, res: ServerResponse, body: unknown) => void,
  run: (origin: string, repoPath: string, seen: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const seen: RecordedRequest[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      let body: unknown = null
      try {
        body = rawBody ? JSON.parse(rawBody) : null
      } catch {
        body = null
      }
      seen.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body })
      handler(req, url, res, body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const repoPath = await mkdtemp(join(tmpdir(), 'orca-bitbucket-server-comments-'))
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

type CommentPostBody = { text?: string; anchor?: unknown }

function asCommentPostBody(body: unknown): CommentPostBody {
  if (typeof body !== 'object' || body === null) {
    return {}
  }
  if (!('text' in body) && !('anchor' in body)) {
    return {}
  }
  const record = body
  return {
    text: 'text' in record && typeof record.text === 'string' ? record.text : undefined,
    anchor: 'anchor' in record ? record.anchor : undefined
  }
}

describe('getBitbucketServerPRComments', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, ORCA_BITBUCKET_SERVER_TOKEN: 'server-token' }
    delete process.env.ORCA_BITBUCKET_SERVER_BASE_URL
    _resetBitbucketServerRepoRefCache()
  })

  afterEach(() => {
    process.env = OLD_ENV
    _resetBitbucketServerRepoRefCache()
  })

  it('fetches per-file and activity comments, mapping threads via parent chains', async () => {
    const orphanedAnchorComment = {
      id: 103,
      text: 'Orphaned anchor comment',
      createdDate: 1_700_000_002_000,
      author: { name: 'carol' },
      anchor: { path: 'src/old.ts', line: 7, orphaned: true }
    }
    const generalComment = {
      id: 104,
      text: 'General comment',
      createdDate: 1_700_000_003_000,
      author: { name: 'dave' }
    }
    await withServerAndRepo(
      (_req, url, res) => {
        const prBase = '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12'
        if (url.pathname === `${prBase}/changes`) {
          sendJson(res, 200, { values: [{ path: 'src/app.ts' }], isLastPage: true })
          return
        }
        if (url.pathname === `${prBase}/comments` && url.searchParams.get('path')) {
          sendJson(res, 200, {
            values: [
              {
                id: 101,
                text: 'Root inline comment',
                createdDate: 1_700_000_000_000,
                author: { name: 'alice' },
                anchor: { path: 'src/app.ts', line: 42, lineType: 'ADDED', fileType: 'TO' }
              },
              {
                id: 102,
                text: 'Reply to root',
                createdDate: 1_700_000_001_000,
                author: { name: 'bob' },
                parent: { id: 101 },
                anchor: { path: 'src/app.ts', line: 42 }
              }
            ],
            isLastPage: true
          })
          return
        }
        if (url.pathname === `${prBase}/activity`) {
          // Orphaned-anchored and general comments surface only via the activity feed.
          sendJson(res, 200, {
            values: [
              { action: 'COMMENT', comment: orphanedAnchorComment },
              { action: 'COMMENT', comment: generalComment },
              { action: 'OPENED', comment: null }
            ],
            isLastPage: true
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await getBitbucketServerPRComments(repoPath, 12, 'local')
        expect(result).toMatchObject({ ok: true })
        if (!result.ok) {
          return
        }
        const byId = new Map(result.comments.map((c) => [c.id, c]))
        expect(byId.get(101)).toMatchObject({
          path: 'src/app.ts',
          line: 42,
          threadId: '101',
          author: 'alice',
          isOutdated: false,
          isResolved: false
        })
        // Why: replies inherit the root's thread id so the renderer can group them.
        expect(byId.get(102)).toMatchObject({ threadId: '101' })
        // Orphaned anchors must not render inline.
        expect(byId.get(103)?.path).toBeUndefined()
        expect(byId.get(104)?.path).toBeUndefined()
        expect(seen.map((r) => r.path)).toEqual([
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/changes?start=0&limit=100',
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/comments?path=src%2Fapp.ts&start=0&limit=100',
          // Why: newer DC exposes /activities; this mock only answers legacy /activity, proving the fallback.
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/activities?start=0&limit=100',
          '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/activity?start=0&limit=100'
        ])
      }
    )
  })

  it('fails fast without a credential', async () => {
    delete process.env.ORCA_BITBUCKET_SERVER_TOKEN
    const result = await getBitbucketServerPRComments('/nonexistent', 12, 'local')
    expect(result).toMatchObject({ ok: false })
  })
})

describe('replyToBitbucketServerPRComment', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, ORCA_BITBUCKET_SERVER_TOKEN: 'server-token' }
    delete process.env.ORCA_BITBUCKET_SERVER_BASE_URL
    _resetBitbucketServerRepoRefCache()
  })

  afterEach(() => {
    process.env = OLD_ENV
    _resetBitbucketServerRepoRefCache()
  })

  it('POSTs a reply with the parent id', async () => {
    await withServerAndRepo(
      (req, url, res, body) => {
        if (
          url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/comments' &&
          req.method === 'POST'
        ) {
          sendJson(res, 201, {
            id: 200,
            text: asCommentPostBody(body).text,
            createdDate: 1_700_000_010_000,
            author: { name: 'rty' },
            parent: { id: 101 }
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await replyToBitbucketServerPRComment(
          repoPath,
          12,
          101,
          'same here',
          'local'
        )
        expect(result).toMatchObject({ ok: true, comment: { id: 200, body: 'same here' } })
        expect(seen).toContainEqual({
          method: 'POST',
          path: '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/comments',
          body: { text: 'same here', parent: { id: 101 } }
        })
      }
    )
  })
})

describe('addBitbucketServerPRLineComment', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, ORCA_BITBUCKET_SERVER_TOKEN: 'server-token' }
    delete process.env.ORCA_BITBUCKET_SERVER_BASE_URL
    _resetBitbucketServerRepoRefCache()
  })

  afterEach(() => {
    process.env = OLD_ENV
    _resetBitbucketServerRepoRefCache()
  })

  it('POSTs an anchored line comment', async () => {
    await withServerAndRepo(
      (req, url, res, body) => {
        if (
          url.pathname === '/rest/api/1.0/projects/prj/repos/repo/pull-requests/12/comments' &&
          req.method === 'POST'
        ) {
          sendJson(res, 201, {
            id: 300,
            text: asCommentPostBody(body).text,
            createdDate: 1_700_000_020_000,
            author: { name: 'rty' },
            anchor: asCommentPostBody(body).anchor
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (origin, repoPath, seen) => {
        process.env.ORCA_BITBUCKET_SERVER_BASE_URL = origin
        const result = await addBitbucketServerPRLineComment(
          repoPath,
          12,
          { path: 'src/app.ts', line: 10, body: 'nit', fromHash: 'a', toHash: 'b' },
          'local'
        )
        expect(result).toMatchObject({
          ok: true,
          comment: { id: 300, path: 'src/app.ts', line: 10 }
        })
        expect(seen).toHaveLength(1)
        expect(seen[0]?.body).toMatchObject({
          text: 'nit',
          anchor: {
            path: 'src/app.ts',
            line: 10,
            lineType: 'ADDED',
            fileType: 'TO',
            fromHash: 'a',
            toHash: 'b'
          }
        })
      }
    )
  })
})
