import type { ExecutionHostId } from './execution-host'
import type { PRReviewDecision } from './github/pull-request-types'

/** One Bitbucket Data Center pull request row for the task page. */
export type BitbucketWorkItem = {
  id: string
  type: 'pr'
  number: number
  title: string
  state: 'open' | 'merged' | 'closed' | 'draft'
  url: string
  updatedAt: string
  author: string | null
  branchName?: string
  baseRefName?: string
  isDraft: boolean
  reviewDecision?: PRReviewDecision | null
  /** Stamped by the renderer so cross-repo views can attribute rows. Mirrors GitHubWorkItem.repoId. */
  repoId: string
  /** Mirrors GitLabWorkItem.repoHostId; the host whose repo row produced this item. */
  repoHostId?: ExecutionHostId
}

export type BitbucketTaskFilter = 'open' | 'mine' | 'needs-review'
