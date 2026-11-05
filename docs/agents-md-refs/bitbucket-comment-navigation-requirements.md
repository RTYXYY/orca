# Bitbucket PR 评论：位置跳转 + AI 发送 — 需求文档

> 版本: 1.0 · 日期: 2026-11-06 · 关联: bitbucket-server-requirements.md US-4 扩展

## 1. 背景

Bitbucket Data Center PR 的评论已收集进 Checks 面板（含 path/line 锚点数据），但与 GitHub 评论相比缺两件事：

1. **点击跳转**：评论行的位置标签（`file.ts:42`）不可点击，无法像 AI note 一样跳到编辑器对应文件与行
2. **AI 发送**：无法把选中的评论组发给 AI agent 处理（"Resolve with AI" 对 bitbucket 已部分可用，但需确认发送链路与 GitHub 同等完整）

## 2. 用户故事

### US-A 点击评论跳转到文件与行

作为评审者，我在 Checks 面板看到 Bitbucket PR 内联评论时：

- 评论显示 `文件名:行号` 位置标签
- 点击后：激活对应 worktree → 打开该文件 → 编辑器光标跳到对应行（与 AI note / GitHub 评论同一交互）
- 无行锚点的评论（孤儿锚点、REMOVED 侧、纯 Activities 评论）不显示可点击标签，但显示纯文件名提示
- 行范围（startLine≠line）跳到 startLine

### US-B 评论发送给 AI

作为评审者，我可以：

- 勾选多个 Bitbucket 评论组，点击 "Resolve PR Comments With AI"
- 弹出 agent 启动确认（prompt 可编辑），prompt 中含每条评论的 path/line JSON
- 确认后启动 agent；发送完成后自动 resolve 已处理线程（bitbucket ack 链路）
- 无 worktree 时（如 task page 远程查看）相应入口禁用并提示原因

## 3. 验收标准

1. Bitbucket PR 内联评论（有 path+line）的位置标签可点击，编辑器跳到该文件行
2. 孤儿/REMOVED/无锚点评论不出现可点击标签
3. "Resolve with AI" 对 bitbucket provider 可用，prompt 含 path/line 元数据
4. AI 发送后的 ack（resolve + 回复）对 Server/Cloud 线程生效
5. 单测覆盖：锚点→跳转参数映射、无锚点降级、AI 队列可用性判定
