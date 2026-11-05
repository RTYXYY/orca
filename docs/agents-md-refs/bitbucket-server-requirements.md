# Bitbucket Data Center / Server 集成 — 需求文档

> 版本: 1.0 · 日期: 2026-11-06 · 来源: 2026-10-30 ~ 2026-11-05 会话记录（/tmp/opencode/session-summaries/）

## 1. 背景与目标

Orca（Electron IDE）已支持 Bitbucket Cloud 的 PR 查看。用户使用自建的 **Bitbucket Data Center / Server 7.9**（REST API 1.0），需要 Orca 对其提供与 Cloud 同级、乃至更深度的 PR 集成：

- 在自托管实例上完成 Orca 内的 PR 全生命周期（查看、创建、评论、审查、合并）
- PR 信息进入 task page，作为任务来源
- AI/机器人评论与人类评论区分展示

## 2. 用户故事

### US-1 凭据连接

作为自托管用户，我可以在 Settings → Integrations 中配置 Bitbucket Data Center：

- 输入 Base URL + Personal Access Token 保存（或用 `ORCA_BITBUCKET_SERVER_BASE_URL` / `ORCA_BITBUCKET_SERVER_TOKEN` 环境变量）
- 凭据明文元数据不触发系统钥匙串解锁提示
- 显示连接状态、账号、可断开/编辑
- Cloud 与 Server 凭据互相独立，可同时连接

### US-2 仓库识别

打开一个仓库时，若其 origin 远端匹配已注册的 Server Base URL，则自动识别为 Server 仓库（projectKey/repoSlug），否则走 Cloud 路径。一个 provider id `bitbucket` 同时服务两者，注册了 Server host 的优先走 Server。

### US-3 PR 查看与创建

- 分支侧栏显示关联 PR（标题、状态、build 状态、可合并状态、review decision）
- 从分支直接 Create PR（标题/描述、默认 reviewer 自动填充、排除自己）
- 冲突/已存在等错误以人类可读文案呈现（含服务端 reason）

### US-4 PR 评论（内联 + 回复）

- diff 视图按行显示 PR 内联评论，支持回复线程
- 通用 PR 评论（Activities）区分展示
- AI/bot 评论带标记（含 `bot-comment` 前缀的视为机器人）

### US-5 PR 审查状态

- 显示 APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED
- approve / unapprove（unapprove 是真实撤回，不是 "no longer a reviewer"；撤回后按钮回到 Approve）
- needs work 同样生效
- DC 特性：reviewers[] 与 participants[] 双来源合并判断（PUT 后状态在 reviewers，DELETE 后在 participants）

### US-6 PR 合并

Orca 内直接合并 Server PR（带乐观并发 version token）。

### US-7 Task Page 集成

Bitbucket DC PR 列表作为 task provider：PR 可像 issue/MR 一样在 task page 列出、筛选、作为任务启动 workspace 的上下文。

### US-8 自动化联动（Automations）

以 Bitbucket task source 为上下文的 automation 在源主机断连/未授权/工具缺失时给出明确的不可运行原因（source-auth-needed 等）。

## 3. 范围边界

**做**：Server 7.9+ REST 1.0、token 认证、本地与远端 execution host、跨平台。
**不做**：Bitbucket Cloud API 变更、OAuth、Server < 7.9、Webhook。

## 4. 验收标准

1. Settings 配置 token 后，Server 仓库的分支面板出现 PR 状态
2. diff 内联评论可显示、回复
3. approve → unapprove → 按钮回到 approve，状态正确流转
4. merge 按钮对可合并 PR 生效
5. task page 出现 Bitbucket PR 列表
6. bot 评论带机器标记
7. 全部单测/集成测试通过；对本地 7.9 实例（http://localhost:7990/）手工冒烟通过
