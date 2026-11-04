import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'

export const BitbucketMergePr = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive()
})

export const BitbucketPRList = z.object({
  repo: requiredString('Missing repo selector'),
  filter: z.enum(['open', 'mine', 'needs-review'])
})

export const BitbucketPRComments = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive()
})

export const BitbucketPRComment = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  body: requiredString('Missing comment body')
})

export const BitbucketPRCommentReply = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  parentCommentId: z.number().int().positive(),
  body: requiredString('Missing comment body')
})

export const BitbucketPRCommentThreadResolve = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  threadRootCommentId: z.number().int().positive(),
  resolved: z.boolean()
})

export const BitbucketPRLineComment = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  path: requiredString('Missing file path'),
  line: z.number().int().positive(),
  body: requiredString('Missing comment body'),
  srcPath: z.string().optional(),
  lineType: z.enum(['ADDED', 'CONTEXT', 'REMOVED']).optional(),
  fromHash: z.string().optional(),
  toHash: z.string().optional()
})

export const BitbucketPRReviewStatus = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  status: z.enum(['APPROVED', 'NEEDS_WORK', 'UNAPPROVED'])
})

export const BitbucketPRTasks = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive()
})

export const BitbucketAddPRTask = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  text: requiredString('Missing task text')
})

export const BitbucketSetPRTaskState = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  taskId: z.number().int().positive(),
  state: z.enum(['OPEN', 'RESOLVED'])
})
