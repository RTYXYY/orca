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

export const BitbucketPRCommentReply = z.object({
  repo: requiredString('Missing repo selector'),
  prNumber: z.number().int().positive(),
  parentCommentId: z.number().int().positive(),
  body: requiredString('Missing comment body')
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
