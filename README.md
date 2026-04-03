
# Restored Claude Code Source


![Preview](preview.png)


  This repository is a restored Claude Code source tree reconstructed primarily from source maps and missing-module backfilling.

  It is not the original upstream repository state. Some files were unrecoverable from source maps and have been replaced with compatibility shims or degraded implementations so the
  project can install and run again.

  ## Current status

  - The source tree is restorable and runnable in a local development workflow.
  - `bun install` succeeds.
  - `bun run version` succeeds.
  - `bun run dev` now routes through the restored CLI bootstrap instead of the temporary `dev-entry` shim.
  - `bun run dev --help` shows the full command tree from the restored CLI.
  - A number of modules still contain restoration-time fallbacks, so behavior may differ from the original Claude Code implementation.

  ## Restored so far

  Recent restoration work has recovered several pieces beyond the initial source-map import:

  - the default Bun scripts now start the real CLI bootstrap path
  - bundled skill content for `claude-api` and `verify` has been rewritten from placeholder files into usable reference docs
  - compatibility layers for Chrome MCP and Computer Use MCP now expose realistic tool catalogs and structured degraded-mode responses instead of empty stubs
  - several explicit placeholder resources have been replaced with working fallback prompts for planning and permission-classifier flows

  Remaining gaps are mostly private/native integrations where the original implementation was not recoverable from source maps, so those areas still rely on shims or reduced behavior.

  ## Why this exists

  Source maps do not contain a full original repository:

  - type-only files are often missing
  - build-time generated files may be absent
  - private package wrappers and native bindings may not be recoverable
  - dynamic imports and resource files are frequently incomplete

  This repository fills those gaps enough to produce a usable, runnable restored workspace.

  ## Run

  Requirements:

  - Bun 1.3.5 or newer
  - Node.js 24 or newer

  Install dependencies:

  ```bash
  bun install
  ```

  Run the restored CLI:

  ```bash
  bun run dev
  ```

  Print the restored version:

  ```bash
  bun run version
  ```

  ## Provider support

  The restored CLI now has an initial multi-provider path for GitHub-backed inference.

  Supported providers today:

  - `github-models`: OpenAI-compatible GitHub Models endpoint
  - `github-copilot`: GitHub Copilot account-backed endpoint for Copilot-hosted Claude models

  Authentication lookup order for both providers is:

  - provider-specific env var
  - `GH_TOKEN`
  - `GITHUB_TOKEN`
  - `gh auth token`

  Log in with GitHub CLI first if you want account-style auth instead of manually setting a token:

  ```bash
  gh auth login
  ```

  Use GitHub Models with the restored Claude Code runtime:

  ```bash
  bun run dev --settings '{"provider":"github-models"}'
  ```

  Or choose a specific GitHub Models model:

  ```bash
  bun run dev --settings '{"provider":"github-models"}' --model "openai/gpt-4.1"
  ```

  Use GitHub Copilot with the restored Claude Code runtime:

  ```bash
  bun run dev --settings '{"provider":"github-copilot"}'
  ```

  You can also switch providers interactively inside the CLI:

  ```text
  /provider
  ```

  The picker shows the available providers, saves the selection to user
  settings, and then opens the existing model picker for the selected provider.

  Useful shortcuts:

  - `/provider` opens the visual provider picker
  - `/provider info` shows the current provider and any active environment override
  - `/provider github-copilot` switches directly to a specific provider
  - `/model` still works after provider changes and only shows models supported by the active provider

  Switch to a validated Copilot-hosted Claude model:

  ```bash
  bun run dev --settings '{"provider":"github-copilot"}' --model "claude-opus-4.6"
  ```

  Copilot-backed models currently validated with the Claude Code runtime and tool loop are:

  - `claude-sonnet-4.6`
  - `claude-opus-4.6`
  - `claude-haiku-4.5`
  - `claude-sonnet-4.5`
  - `claude-opus-4.5`
  - `claude-sonnet-4`

  Current limitation:

  - Copilot-hosted Claude models are working through the existing Claude Code agent/runtime path.
  - Copilot-hosted GPT/Grok style models are not fully wired into the Claude Code runtime yet because they primarily require Copilot's `/responses` API path rather than the current chat/messages shim.

  ## 中文说明

  # 还原后的 Claude Code 源码

  ![Preview](preview.png)

  这个仓库是一个主要通过 source map 逆向还原、再补齐缺失模块后得到的 Claude Code 源码树。

  它并不是上游仓库的原始状态。部分文件无法仅凭 source map 恢复，因此目前仍包含兼容 shim 或降级实现，以便项目可以重新安装并运行。

  ### 当前状态

  - 该源码树已经可以在本地开发流程中恢复并运行。
  - `bun install` 可以成功执行。
  - `bun run version` 可以成功执行。
  - `bun run dev` 现在会通过还原后的真实 CLI bootstrap 启动，而不是临时的 `dev-entry`。
  - `bun run dev --help` 可以显示还原后的完整命令树。
  - 仍有部分模块保留恢复期 fallback，因此行为可能与原始 Claude Code 实现不同。

  ### 已恢复内容

  最近一轮恢复工作已经补回了最初 source-map 导入之外的几个关键部分：

  - 默认 Bun 脚本现在会走真实的 CLI bootstrap 路径
  - `claude-api` 和 `verify` 的 bundled skill 内容已经从占位文件恢复为可用参考文档
  - Chrome MCP 和 Computer Use MCP 的兼容层现在会暴露更接近真实的工具目录，并返回结构化的降级响应，而不是空 stub
  - 一些显式占位资源已经替换为可用的 planning 与 permission-classifier fallback prompt

  当前剩余缺口主要集中在私有或原生集成部分，这些实现无法仅凭 source map 完整恢复，因此这些区域仍依赖 shim 或降级行为。

  ### 为什么会有这个仓库

  source map 本身并不能包含完整的原始仓库：

  - 类型专用文件经常缺失
  - 构建时生成的文件可能不存在
  - 私有包包装层和原生绑定可能无法恢复
  - 动态导入和资源文件经常不完整

  这个仓库的目标是把这些缺口补到“可用、可运行”的程度，形成一个可继续修复的恢复工作区。

  ### 运行方式

  环境要求：

  - Bun 1.3.5 或更高版本
  - Node.js 24 或更高版本

  安装依赖：

  ```bash
  bun install
  ```

  运行恢复后的 CLI：

  ```bash
  bun run dev
  ```

  输出恢复后的版本号：

  ```bash
  bun run version
  ```

  ### Provider 支持

  当前恢复版 CLI 已经补上了一条初步的多 provider 路径，可以接 GitHub 侧的推理服务。

  目前可用的 provider：

  - `github-models`：OpenAI-compatible 的 GitHub Models 接口
  - `github-copilot`：基于 GitHub Copilot 账号态的接口，当前主要支持 Copilot 托管的 Claude 模型

  这两个 provider 的鉴权查找顺序都是：

  - provider 专用环境变量
  - `GH_TOKEN`
  - `GITHUB_TOKEN`
  - `gh auth token`

  如果你想走“GitHub 账号登录态”而不是手填 token，可以先执行：

  ```bash
  gh auth login
  ```

  使用 GitHub Models 跑恢复版 Claude Code runtime：

  ```bash
  bun run dev --settings '{"provider":"github-models"}'
  ```

  指定 GitHub Models 模型：

  ```bash
  bun run dev --settings '{"provider":"github-models"}' --model "openai/gpt-4.1"
  ```

  使用 GitHub Copilot 跑恢复版 Claude Code runtime：

  ```bash
  bun run dev --settings '{"provider":"github-copilot"}'
  ```

  现在也可以在 CLI 内通过交互式命令切换 provider：

  ```text
  /provider
  ```

  这个 picker 会列出当前可用 provider，把选择写入用户 settings，然后继续打开该 provider 对应的模型选择器。

  常用命令：

  - `/provider`：打开可视化 provider 选择器
  - `/provider info`：显示当前 provider 和是否存在环境变量覆盖
  - `/provider github-copilot`：直接切换到指定 provider
  - `/model`：在切 provider 之后继续切模型，只显示当前 provider 支持的模型

  切换到已经验证可用的 Copilot Claude 模型：

  ```bash
  bun run dev --settings '{"provider":"github-copilot"}' --model "claude-opus-4.6"
  ```

  当前已经验证能跑 Claude Code runtime 和工具循环的 Copilot 模型有：

  - `claude-sonnet-4.6`
  - `claude-opus-4.6`
  - `claude-haiku-4.5`
  - `claude-sonnet-4.5`
  - `claude-opus-4.5`
  - `claude-sonnet-4`

  当前限制：

  - Copilot 托管的 Claude 模型已经可以走现有 Claude Code agent/runtime 路径。
  - Copilot 托管的 GPT/Grok 一类模型还没有完整接进来，因为它们主要需要走 Copilot 的 `/responses` API，而当前适配层主要还是 chat/messages 这条路径。
