# Bitbucket Data Center / Server 集成 — 测试文档

> 版本: 1.0 · 日期: 2026-11-06

## 1. 测试分层

| 层       | 文件模式                | 环境                     | 数量                                    |
| -------- | ----------------------- | ------------------------ | --------------------------------------- |
| 单元     | `*.test.ts`             | mock fetch/git           | 147（src/main/bitbucket/）              |
| 集成     | `*.integration.test.ts` | 127.0.0.1 假 HTTP server | comments/list/merge/review-status/tasks |
| E2E      | `*.e2e.test.ts`         | 真实实例（env 指定）     | review-status                           |
| Renderer | `*.test.tsx`            | jsdom                    | integration-card 等                     |

## 2. 运行方式

```bash
pnpm test src/main/bitbucket/ --maxWorkers=2
pnpm test src/main/source-control/ --maxWorkers=2

# E2E（需实例运行中）
ORCA_BITBUCKET_SERVER_BASE_URL=http://localhost:7990/ \
ORCA_BITBUCKET_SERVER_TOKEN=<token> \
pnpm test src/main/bitbucket/server-pull-request-review-status.e2e.test.ts
```

## 3. 手工冒烟清单（localhost:7990）

1. Settings → Integrations → Bitbucket Data Center → 连接（token 认证成功，显示账号）
2. 打开 origin 指向该实例的仓库 → 分支面板出现 PR 状态/build 状态/review decision
3. diff 视图看到内联评论，回复一条
4. Approve → 状态 APPROVED；Unapprove → 回 REVIEW_REQUIRED，按钮回到 Approve
5. Needs work → CHANGES_REQUESTED
6. Merge → PR 合并，version 冲突时提示重试
7. Task page 出现 Bitbucket PR 列表
8. bot 评论（正文以 `bot-comment` 开头）带机器标记

## 4. 已知验证记录（2026-11-05）

- `pnpm tc` 全绿
- bitbucket 147 + source-control 182 测试全绿
- token 对 7.9.1 实例 REST 探测 200
