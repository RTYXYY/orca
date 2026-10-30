import { defineMethod } from '../core'
import {
  BitbucketMergePr,
  BitbucketPRCommentReply,
  BitbucketPRComments,
  BitbucketPRLineComment,
  BitbucketPRList
} from '../../../../shared/rpc-contract/bitbucket-params'

export const BITBUCKET_METHODS = [
  defineMethod({
    name: 'bitbucket.mergePR',
    permission: 'workspace',
    params: BitbucketMergePr,
    handler: async (params, { runtime }) =>
      runtime.mergeBitbucketRepoPR(params.repo, params.prNumber)
  }),
  defineMethod({
    name: 'bitbucket.listPRs',
    permission: 'workspace',
    params: BitbucketPRList,
    handler: async (params, { runtime }) =>
      runtime.listBitbucketRepoPullRequests(params.repo, params.filter)
  }),
  defineMethod({
    name: 'bitbucket.prComments',
    permission: 'workspace',
    params: BitbucketPRComments,
    handler: async (params, { runtime }) =>
      runtime.getBitbucketRepoPRComments(params.repo, params.prNumber)
  }),
  defineMethod({
    name: 'bitbucket.addPRCommentReply',
    permission: 'workspace',
    params: BitbucketPRCommentReply,
    handler: async (params, { runtime }) =>
      runtime.replyToBitbucketRepoPRComment(
        params.repo,
        params.prNumber,
        params.parentCommentId,
        params.body
      )
  }),
  defineMethod({
    name: 'bitbucket.addPRLineComment',
    permission: 'workspace',
    params: BitbucketPRLineComment,
    handler: async (params, { runtime }) =>
      runtime.addBitbucketRepoPRLineComment(params.repo, params.prNumber, {
        path: params.path,
        line: params.line,
        body: params.body,
        srcPath: params.srcPath,
        lineType: params.lineType,
        fromHash: params.fromHash,
        toHash: params.toHash
      })
  })
]
