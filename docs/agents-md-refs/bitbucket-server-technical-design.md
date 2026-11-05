# Bitbucket Data Center / Server 集成 — 技术实现文档

> 版本: 1.0 · 日期: 2026-11-06 · 对应提交: 1ad41d0d474 … 82333f05d79

## 1. 架构总览

```
Renderer                          Main                          Bitbucket DC 7.9
────────                          ────                          ────────────────
IntegrationsPane
 └ BitbucketServerIntegrationCard ─→ ipc bitbucket-server ──→ server-credential-store (加密文件)
Checks panel / diff view          registerBitbucketServerHandlers
 └ use-bitbucket-pr-diff-comments   ├ runtime RPC (rpc-contract/bitbucket-params)
   use-bitbucket-review-status      │  └ RuntimeBitbucketMutationCommands
HostedReviewActions (approve/      │      ├ mergeBitbucketRepoPR
 └ merge/approve/unapprove)        │      ├ comment create/reply
task-page/bitbucket/*              │      └ review status transitions
 └ bitbucket-task-pr-rpc           └ forge provider 路由（Cloud vs Server）
```

## 2. 模块清单（src/main/bitbucket/）

| 模块                                    | 职责                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| server-auth-config.ts                   | env(`ORCA_BITBUCKET_SERVER_BASE_URL/TOKEN`) + 存储；`serverAuthHeaders`（Bearer + `X-Atlassian-Token: no-check` + `User-Agent: Orca`，绕过 XSRF） |
| server-credential-store.ts              | 加密凭据文件（与 Cloud 分离），明文元数据读取不触发解密                                                                                           |
| server-repository-ref.ts                | origin URL → {baseUrl, projectKey, repoSlug}，带 TTL 负缓存 probe cache                                                                           |
| server-client.ts                        | REST 1.0 核心：按分支/编号取 PR、build status、merge check                                                                                        |
| server-pull-request-mappers.ts          | Raw → `BitbucketPullRequestInfo`；`deriveBitbucketServerReviewDecision` 合并 reviewers[]+participants[]                                           |
| server-pull-request-creation.ts         | 创建 PR、默认 reviewer（排除自己）、409/超时分类                                                                                                  |
| server-pull-request-comments.ts         | 内联评论 + Activities，回复线程                                                                                                                   |
| server-pull-request-review-status.ts    | approve/unapprove/needs-work 状态迁移                                                                                                             |
| server-pull-request-merge.ts            | merge，携带 PR `version` 乐观并发 token                                                                                                           |
| server-pull-request-list.ts / -tasks.ts | task page PR 列表数据源                                                                                                                           |
| server-request-errors.ts                | 服务端 JSON errors[].message 提取                                                                                                                 |

## 3. 关键设计决策

### 3.1 单 provider 双后端

Forge provider id `bitbucket` 内部按 `getBitbucketServerRepoRef()` 是否命中分流：命中走 Server client，未命中走 Cloud。**注册的 Server host 优先**。

### 3.2 Review decision 双来源合并

DC 的行为：approve/needs-work（PUT）后状态在 `reviewers[]`；unapprove（DELETE）后条目移到 `participants[]` 且状态 UNAPPROVED。`deriveBitbucketServerReviewDecision` 将两数组合并判定：NEEDS_WORK→CHANGES_REQUESTED，APPROVED 存在→APPROVED，否则 REVIEW_REQUIRED，空→null。

### 3.3 认证头

`X-Atlassian-Token: no-check` + 自定义 UA 必需：Electron 的 Chrome UA 会触发 Atlassian XSRF 拦截（与 Jira client 同样处理）。

### 3.4 乐观并发

merge 端点要求 PR `version`；PR 对象自携带，merge 时回传，409 即版本冲突。

### 3.5 Bot 评论判定

`src/shared/pr-comment-audience.ts`：评论体以 `bot-comment` 前缀标记 → bot（用户在 11-04 会话确认的约定）。

### 3.6 Runtime RPC

变更类操作（merge/comment/review）走 `RuntimeBitbucketMutationCommands` + 生成的 `rpc-params-catalog`，使本地与远端 execution host 行为一致；查询类直连。

## 4. Renderer 结构

- `components/settings/bitbucket-server-integration-card.tsx` — 连接卡（含凭据对话框）
- `components/editor/combined-diff/bitbucket-pr-inline-comments.ts` + `use-bitbucket-pr-diff-comments.ts` — diff 行级评论
- `components/right-sidebar/use-bitbucket-review-status.ts` — 审查状态 hook
- `components/right-sidebar/hosted-review-bitbucket-actions.ts` — approve/unapprove/merge 动作
- `components/task-page/bitbucket/*` — task provider（ItemList、rpc、loading）
- `automations/automation-target-availability.ts` — 新增 4 个 source-* 不可运行原因

## 5. 测试基建

- 单测：mock fetch + gitExecFileAsync，无网络
- `.integration.test.ts`：本地 HTTP 假服务器（127.0.0.1 随机端口）验证完整管线
- `.e2e.test.ts`：对 `ORCA_BITBUCKET_SERVER_BASE_URL` 指向的真实实例（本机 docker 7.9.1，http://localhost:7990/）
