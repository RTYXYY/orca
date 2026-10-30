import type { Repo } from '../../shared/repo-types'
import { mergeBitbucketServerPullRequest } from '../bitbucket/server-pull-request-merge'
import { getBitbucketServerPRComments } from '../bitbucket/server-pull-request-comments'
import {
  addBitbucketServerPRLineComment,
  replyToBitbucketServerPRComment
} from '../bitbucket/server-pull-request-comment-create'
import {
  listBitbucketServerPullRequests,
  type BitbucketPRListFilter
} from '../bitbucket/server-pull-request-list'
import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import { getStoredRepoExecutionHostId } from '../repo-execution-host'

type LocalGitArgs = [] | [{ wslDistro?: string }]

type RuntimeBitbucketMutationCommandsDeps = {
  resolveRepo: (selector: string) => Promise<Repo>
  getLocalGitArgs: (repo: Repo) => LocalGitArgs
}

export class RuntimeBitbucketMutationCommands {
  constructor(private readonly deps: RuntimeBitbucketMutationCommandsDeps) {}

  private async resolveRepoContext(repoSelector: string) {
    const repo = await this.deps.resolveRepo(repoSelector)
    const [localGitArgs] = this.deps.getLocalGitArgs(repo)
    return {
      repo,
      executionHostId: getStoredRepoExecutionHostId(repo),
      connectionId: getRepoRoutingConnectionId(repo),
      options: localGitArgs ? { localGitExecOptions: localGitArgs } : {}
    }
  }

  async mergeBitbucketRepoPR(repoSelector: string, prNumber: number) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return mergeBitbucketServerPullRequest(
      repo.path,
      prNumber,
      executionHostId,
      connectionId,
      options
    )
  }

  async listBitbucketRepoPullRequests(repoSelector: string, filter: BitbucketPRListFilter) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return listBitbucketServerPullRequests(
      repo.path,
      filter,
      executionHostId,
      connectionId,
      options
    )
  }

  async getBitbucketRepoPRComments(repoSelector: string, prNumber: number) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return getBitbucketServerPRComments(repo.path, prNumber, executionHostId, connectionId, options)
  }

  async replyToBitbucketRepoPRComment(
    repoSelector: string,
    prNumber: number,
    parentCommentId: number,
    body: string
  ) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return replyToBitbucketServerPRComment(
      repo.path,
      prNumber,
      parentCommentId,
      body,
      executionHostId,
      connectionId,
      options
    )
  }

  async addBitbucketRepoPRLineComment(
    repoSelector: string,
    prNumber: number,
    args: {
      path: string
      line: number
      body: string
      srcPath?: string
      lineType?: 'ADDED' | 'CONTEXT' | 'REMOVED'
      fromHash?: string
      toHash?: string
    }
  ) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return addBitbucketServerPRLineComment(
      repo.path,
      prNumber,
      args,
      executionHostId,
      connectionId,
      options
    )
  }
}
