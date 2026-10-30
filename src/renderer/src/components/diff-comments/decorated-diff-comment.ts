import type { DiffComment } from '../../../../shared/diff-comment-types'

export type DecoratedDiffComment = DiffComment & {
  author?: string
  authorAvatarUrl?: string
  createdAtLabel?: string
  url?: string
  canDelete?: boolean
  canEdit?: boolean
  /** Remote thread reply support (e.g. Bitbucket DC PR comments); absent on local notes. */
  onReply?: (body: string) => Promise<boolean>
}
