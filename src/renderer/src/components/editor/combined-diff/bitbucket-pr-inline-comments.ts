import type { DecoratedDiffComment } from '@/components/diff-comments/decorated-diff-comment'
import { formatRelativeTime } from '@/components/github/work-item-state-presentation'
import type { PRComment } from '../../../../../shared/github/comment-types'

export function bitbucketPRCommentWorktreeId(repoId: string, prNumber: number): string {
  return `bitbucket-pr:${repoId}:${prNumber}`
}

export function buildBitbucketInlineReviewComments(
  comments: PRComment[],
  repoId: string,
  prNumber: number
): DecoratedDiffComment[] {
  return comments.flatMap((comment): DecoratedDiffComment[] => {
    // Why: outdated or unanchored comments cannot be placed on the current diff.
    if (comment.isOutdated || !comment.path || typeof comment.line !== 'number') {
      return []
    }
    const createdAtMs = new Date(comment.createdAt).getTime()
    return [
      {
        id: `bitbucket-pr-comment:${comment.id}`,
        worktreeId: bitbucketPRCommentWorktreeId(repoId, prNumber),
        filePath: comment.path,
        source: 'diff',
        lineNumber: comment.line,
        body: comment.body,
        createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
        side: 'modified',
        author: comment.author,
        authorAvatarUrl: comment.authorAvatarUrl,
        createdAtLabel: formatRelativeTime(comment.createdAt),
        url: comment.url,
        canDelete: false,
        canEdit: false
      }
    ]
  })
}
