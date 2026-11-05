# Bitbucket PR 评论：位置跳转 + AI 发送 — 技术实现文档

> 版本: 1.0 · 日期: 2026-11-06

## 1. 现状盘点（实现前）

| 能力            | 数据/代码                                                                                                                                                             | 状态                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 评论锚点数据    | `src/main/bitbucket/server-pull-request-comments.ts` — anchor{path,line,lineType,orphaned} → `PRComment.path/line/startLine`                                          | ✅ 已有                       |
| 位置标签渲染    | `checks-panel/comments/comment-controls.tsx` `CommentLocationControl` — 有 `onOpenLocation` 即可点击                                                                  | ✅ 通用组件                   |
| 跳转实现        | `editor/check-details/actions/check-annotation-open.ts` `openAnnotationLocation({worktreeId, executionHostId, path, line})` → `openFile` + `scheduleEditorLineReveal` | ✅ 通用                       |
| Checks 面板接线 | `active-content.tsx:284` — `onOpenLocation={activeWorktree ? ... : undefined}`（provider 无关）                                                                       | 需验证 bitbucket 分支实际拿到 |
| AI 队列         | `use-checks-panel-ai-queue.tsx` — `bitbucketTarget` 已构造，`buildPRCommentsResolutionPrompt` 序列化 path/line                                                        | ✅ 已有                       |
| AI ack          | `use-checks-panel-ai-acknowledgement.tsx` — bitbucket resolve + 回复分支                                                                                              | ✅ 已有                       |
| 队列可用性判定  | `pr-comment-action-state.ts` `isPRCommentGroupQueueableForAI`                                                                                                         | 需验证 bitbucket 组不误禁用   |

## 2. 设计

**原则：零新数据面。** 所有基础能力 provider 无关，缺的是把 Bitbucket 评论组接进已有管线并补测试。新增代码集中在：

1. **锚点归一化** `src/renderer/src/lib/bitbucket-comment-anchor.ts`
   - `bitbucketCommentLocation(comment): { path, line } | null`
   - 规则：`path` 非空且 `line` 为正整数 → `{path, line: startLine ?? line}`；否则 null（孤儿/REMOVED/Activities）
   - 供 CommentLocationControl 与 AI prompt 共用，避免两处判断漂移
2. **跳转接线**：`use-comments-list-state.tsx` 行级 `onOpenLocation` 已透传；确认 bitbucket review path 下 `activeWorktree` 解析正确（active-content.tsx 现有逻辑）
3. **AI 发送**：`use-checks-panel-ai-queue.tsx` bitbucket 分支已含 `bitbucketTarget`；将评论 `path/line` 经 `bitbucketCommentLocation` 归一后进入 prompt（prompt 构建器已读 `comment.path/line`，仅确认无 undefined 泄漏）

## 3. 数据流（跳转）

```
Checks panel comment row (bitbucket)
  └ CommentLocationControl label "src/app.ts:42"
    └ onOpenLocation(path, startLine ?? line)
      └ openAnnotationLocation({worktreeId, hostId, path, line})
        ├ resolveAnnotationPathInsideWorktree
        ├ activateAndRevealWorktree
        ├ store.openFile(...)
        └ scheduleEditorLineReveal → Monaco setPendingEditorReveal
```

## 4. 数据流（AI 发送）

```
selection → "Resolve PR Comments With AI"
  └ handleResolveCommentsWithAI(groups)
    ├ bitbucketTarget = {repoPath, repoId, prNumber}
    ├ prompt = buildPRCommentsResolutionPrompt({groups(path,line), ...})
    └ openOrStart({actionId:'resolveComments', prompt, commentResolution})
发送完成 ack（use-checks-panel-ai-acknowledgement）
  ├ resolveBitbucketPRCommentThread（threadId）
  └ 回复无法 resolve 的线程（addPRCommentReply）
```

## 5. 改进项（本轮顺带落地，来自上一轮设计评审）

- **统一 HTTP 层**：新增 `src/main/bitbucket/server-request.ts`（`serverRequestJson`），读路径 server-client/list/merge-version 全部收口，auth/timeout/错误分类一处维护（改进 #1，已完成）
- **review decision 显式状态集**：`CHANGES_REQUESTED_STATUSES`/`APPROVED_STATUSES` + `trim()`，空状态列表 → null（改进 #2，已完成）
