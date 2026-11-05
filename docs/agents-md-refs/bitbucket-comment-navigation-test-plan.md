# Bitbucket PR 评论：位置跳转 + AI 发送 — 测试文档

> 版本: 1.0 · 日期: 2026-11-06

## 1. 测试矩阵

| 层                 | 对象                                                    | 断言要点                                                                     |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 单元               | `bitbucket-comment-anchor.ts`                           | 有 path+line → location；startLine 优先；孤儿/REMOVED/无 path/无 line → null |
| 单元（已有，回归） | `server-pull-request-comments.ts`                       | anchor→PRComment.path/line 映射、orphaned→isOutdated                         |
| 单元               | `pr-comment-action-state.ts`                            | bitbucket 组 queueable 判定不因 provider 误禁用                              |
| 单元               | `use-checks-panel-ai-queue`（如现有测试结构允许）       | bitbucket 分支生成 bitbucketTarget、prompt 含 path/line                      |
| 集成               | 既有 `server-pull-request-comments.integration.test.ts` | 评论拉取管线不回归                                                           |
| 手工               | localhost:7990                                          | 见 §3                                                                        |

## 2. 运行

```bash
pnpm test src/renderer/src/lib/bitbucket-comment-anchor.test.ts --maxWorkers=2
pnpm test src/main/bitbucket/ --maxWorkers=2
pnpm test src/renderer/src/components/right-sidebar/checks-panel/ --maxWorkers=2
```

## 3. 手工冒烟（localhost:7990）

1. 打开 Server PR 的 Checks 面板 → 内联评论显示 `file.ts:42`，点击 → 编辑器打开该文件并跳到第 42 行
2. 孤儿锚点评论（push 新提交使其 outdated）→ 无可点击标签
3. 勾选评论组 → "Resolve PR Comments With AI" → prompt 预览含 path/line → 启动 agent
4. agent 收到 prompt 后，发送完成的线程被自动 resolve
