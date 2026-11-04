import type { Repo } from '../../shared/repo-types'
import { mergeBitbucketServerPullRequest } from '../bitbucket/server-pull-request-merge'
import { getBitbucketServerPRComments } from '../bitbucket/server-pull-request-comments'
import {
  addBitbucketServerPRComment,
  addBitbucketServerPRLineComment,
  replyToBitbucketServerPRComment,
  resolveBitbucketServerPRCommentThread
} from '../bitbucket/server-pull-request-comment-create'
import { setBitbucketServerPRReviewStatus } from '../bitbucket/server-pull-request-review-status'
import {
  addBitbucketServerPRTask,
  getBitbucketServerPRTasks,
  setBitbucketServerPRTaskState
} from '../bitbucket/server-pull-request-tasks'
import {
  listBitbucketServerPullRequests,
  type BitbucketPRListFilter
} from '../bitbucket/server-pull-request-list'
import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import { getStoredRepoExecutionHostId } from '../workspaces/execution-host/repo-execution-host'

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

  async addBitbucketRepoPRComment(repoSelector: string, prNumber: number, body: string) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return addBitbucketServerPRComment(
      repo.path,
      prNumber,
      body,
      executionHostId,
      connectionId,
      options
    )
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

  async resolveBitbucketRepoPRCommentThread(
    repoSelector: string,
    prNumber: number,
    threadRootCommentId: number,
    resolved: boolean
  ) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return resolveBitbucketServerPRCommentThread(
      repo.path,
      prNumber,
      threadRootCommentId,
      resolved,
      executionHostId,
      connectionId,
      options
    )
  }

  async setBitbucketRepoPRReviewStatus(
    repoSelector: string,
    prNumber: number,
    status: 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED'
  ) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return setBitbucketServerPRReviewStatus(
      repo.path,
      prNumber,
      status,
      executionHostId,
      connectionId,
      options
    )
  }

  async getBitbucketRepoPRTasks(repoSelector: string, prNumber: number) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return getBitbucketServerPRTasks(repo.path, prNumber, executionHostId, connectionId, options)
  }

  async addBitbucketRepoPRTask(repoSelector: string, prNumber: number, text: string) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return addBitbucketServerPRTask(
      repo.path,
      prNumber,
      text,
      executionHostId,
      connectionId,
      options
    )
  }

  async setBitbucketRepoPRTaskState(
    repoSelector: string,
    prNumber: number,
    taskId: number,
    state: 'OPEN' | 'RESOLVED'
  ) {
    const { repo, executionHostId, connectionId, options } =
      await this.resolveRepoContext(repoSelector)
    return setBitbucketServerPRTaskState(
      repo.path,
      prNumber,
      taskId,
      state,
      executionHostId,
      connectionId,
      options
    )
  }
}
