import { defineMethod } from '../core'
import {
  BitbucketAddPRTask,
  BitbucketMergePr,
  BitbucketPRComment,
  BitbucketPRCommentReply,
  BitbucketPRCommentThreadResolve,
  BitbucketPRComments,
  BitbucketPRLineComment,
  BitbucketPRList,
  BitbucketPRReviewStatus,
  BitbucketPRTasks,
  BitbucketSetPRTaskState
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
    name: 'bitbucket.addPRComment',
    permission: 'workspace',
    params: BitbucketPRComment,
    handler: async (params, { runtime }) =>
      runtime.addBitbucketRepoPRComment(params.repo, params.prNumber, params.body)
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
  }),
  defineMethod({
    name: 'bitbucket.resolvePRCommentThread',
    permission: 'workspace',
    params: BitbucketPRCommentThreadResolve,
    handler: async (params, { runtime }) =>
      runtime.resolveBitbucketRepoPRCommentThread(
        params.repo,
        params.prNumber,
        params.threadRootCommentId,
        params.resolved
      )
  }),
  defineMethod({
    name: 'bitbucket.setPRReviewStatus',
    permission: 'workspace',
    params: BitbucketPRReviewStatus,
    handler: async (params, { runtime }) =>
      runtime.setBitbucketRepoPRReviewStatus(params.repo, params.prNumber, params.status)
  }),
  defineMethod({
    name: 'bitbucket.prTasks',
    permission: 'workspace',
    params: BitbucketPRTasks,
    handler: async (params, { runtime }) =>
      runtime.getBitbucketRepoPRTasks(params.repo, params.prNumber)
  }),
  defineMethod({
    name: 'bitbucket.addPRTask',
    permission: 'workspace',
    params: BitbucketAddPRTask,
    handler: async (params, { runtime }) =>
      runtime.addBitbucketRepoPRTask(params.repo, params.prNumber, params.text)
  }),
  defineMethod({
    name: 'bitbucket.setPRTaskState',
    permission: 'workspace',
    params: BitbucketSetPRTaskState,
    handler: async (params, { runtime }) =>
      runtime.setBitbucketRepoPRTaskState(params.repo, params.prNumber, params.taskId, params.state)
  })
]
