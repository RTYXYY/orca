export type CommentLocation = {
  path: string
  line: number
}

export type PRCommentLocationFields = {
  path?: string | undefined
  line?: number | undefined
  startLine?: number | undefined
  isOutdated?: boolean | undefined
}

/**
 * Resolvable editor location for a PR comment; null when the comment cannot be
 * placed (orphaned/outdated anchor, removed-side anchor, or a conversation comment).
 * Shared by the Checks panel location control and the AI resolution prompt so the
 * two never disagree about which comments are placeable.
 */
export function prCommentLocation(comment: PRCommentLocationFields): CommentLocation | null {
  if (comment.isOutdated || !comment.path) {
    return null
  }
  const line = comment.startLine ?? comment.line
  return typeof line === 'number' && Number.isSafeInteger(line) && line > 0
    ? { path: comment.path, line }
    : null
}
