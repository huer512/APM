# APM (Agent Pipline Manager)

APM 是一个基于 Cursor SDK（`@cursor/sdk`）的 Agent Pipeline 引擎，支持：

- 按目录配置解析 `prompts/`、`stages/`、`hosts/`、`entries/`
- `apm daemon` + `apm` CLI 的工作流运行管理
- `apm attach` 的 human-in-the-loop 介入与手动推进下一阶段
- 结构化 JSONL 事件日志（含 SDK tool_call），支持 `apm logs --json/--follow/--kind`
- prompt frontmatter `skills: true` 加载 project 级 Cursor Skill
- `apm run` 前台跟随执行日志，`apm run -d` 后台提交后立即返回
- `apm run -a` 启动后立即进入 attach TUI
- SSH 主机执行（要求远端已安装 `node` 与 `@cursor/sdk`）

## 安装

```bash
npm install
npm run build
```

## 二进制构建（Node SEA）

APM 使用 **esbuild 预打包 + Node SEA** 产出单文件二进制，输出到 `dist/bin/`。

构建要求：**Node 22+**（推荐；Node 20 会回退到 `postject` 流程）。跨平台产物需在对应 OS/arch 上分别构建（见 GitHub Actions 矩阵）。

### 目标矩阵

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

产物命名：

- `apm-<os>-<arch>`（Windows 为 `.exe`）
- `apm-daemon-<os>-<arch>`（Windows 为 `.exe`）

### 构建命令

仅当前平台：

```bash
npm run build:bin
```

全部平台（需在各自平台 runner 上执行，或由 CI 矩阵产出）：

```bash
npm run build:bin:all
```

发布构建（JS + 当前平台 SEA 二进制）：

```bash
npm run build:release
```

构建链路：`tsc` → 收集原生 assets（`rg` / `cursorsandbox` / `sqlite3.node`）→ esbuild bundle → SEA 注入。

构建清单会写入：`dist/bin/manifest.json`。

### 二进制冒烟验证

```bash
npm run smoke:bin
npm run smoke:sea   # 需要 CURSOR_API_KEY，验证 SEA daemon 跑通 test_local
```

该脚本会验证：

- `apm --help`
- `apm-daemon --help`
- `apm run --help`
- `apm attach --help`
- 启动 **apm-daemon** 二进制并执行一次最小 `run/ps` 链路

需要设置 API Key（用于 `smoke:sea`）：

```bash
export CURSOR_API_KEY="cursor_..."
```

### SEA 运行时说明

- **apm-daemon** 首次启动会将 SEA assets 解压到 `~/.apm/runtime/<platform-arch>/`（含 `rg`、`cursorsandbox`、`sqlite3.node`）。
- **apm** CLI 二进制不含 Cursor SDK；请使用 **apm-daemon** 二进制启动 daemon（`apm daemon` 在 SEA 版 apm 中会提示改用 apm-daemon）。

## 默认配置目录（家目录）

APM 现在默认使用 `~/.apm` 作为配置根目录（可通过 `APM_HOME` 覆盖）。

daemon 首次启动时会自动初始化：

```text
~/.apm/
  prompts/
  stages/
  hosts/
  entries/
  state/
    runs.json
    events/
  config.json
```

其中 `config.json` 用于配置 Cursor Key：

```json
{
  "cursorApiKey": "cursor_xxx"
}
```

## 目录约定

在 `~/.apm` 下：

```text
prompts/
stages/
hosts/
entries/
```

并可参考 `examples/minimal/`。

## 启动 daemon

```bash
npx tsx src/bin/apm-daemon.ts
```

或：

```bash
npx tsx src/bin/apm.ts daemon
```

使用二进制（Linux x64 示例）：

```bash
./dist/bin/apm-linux-x64 daemon
```

## 运行工作流

```bash
npx tsx src/bin/apm.ts run demo -p task=整理代码结构
```

默认前台运行并持续输出日志，完成后退出。

后台运行：

```bash
npx tsx src/bin/apm.ts run demo -d -p task=整理代码结构
```

启动后立即 attach（human-in-the-loop）：

```bash
npx tsx src/bin/apm.ts run demo -a -p task=整理代码结构
```

说明：`-a/--attach` 与 `-d/--detach` 互斥，不能同时使用。在 attach TUI 中 `:quit` 退出后，工作流会在 daemon 后台继续执行（不再暂停等待 `:next`）。

使用二进制（Linux x64 示例）：

```bash
./dist/bin/apm-linux-x64 run demo -a -p task=整理代码结构
./dist/bin/apm-linux-x64 run demo -d -p task=整理代码结构
```

返回 run id 后可查看：

```bash
npx tsx src/bin/apm.ts ps
npx tsx src/bin/apm.ts logs <runId>
npx tsx src/bin/apm.ts logs <runId> --json
npx tsx src/bin/apm.ts logs <runId> --follow
npx tsx src/bin/apm.ts logs <runId> --kind tool
```

### Prompt Skills

在 prompt frontmatter 中设置 `skills: true` 可为该 prompt 对应的 agent 启用 project 级 Cursor 配置（`.cursor/skills/` 等）：

```yaml
---
model: auto
skills: true
---
```

省略或 `skills: false` 时保持最小 Agent 配置（默认行为）。

## Attach 与人工介入

```bash
npx tsx src/bin/apm.ts attach <runId>
```

attach 中支持命令：

- `:help`
- `:stage <stage_name>`：切换查看阶段
- `:prompt <prompt_name>`：切换查看 prompt
- `:tools`：切换 tool-only 事件视图
- `:msg <prompt_name> <message>`：向当前阶段 prompt 对应 agent 发送消息
- `:next`：手动推进到下一阶段
- `:quit`：退出 attach

当 attach 激活时，每个并行批次执行完会统一暂停，直到 `:next` 才会进入下一批后继阶段。

## 桌面应用（APM Desktop）

基于 **Tauri 2 + React** 的桌面控制 UI（类似 Docker Desktop），提供：

- Daemon 启停与状态
- 运行实例列表、日志 SSE、Attach/HITL
- `~/.apm` 配置工作室（prompts / stages / hosts / entries）
- 设置（API Key、HTTP API 端口）

### 前置条件

- Node 22+
- Rust toolchain（`cargo`、`rustc`，用于 `tauri build`）
- Linux 桌面开发建议安装 `webkit2gtk` 等 Tauri 系统依赖

### 开发模式

1. 启用 HTTP API（在 `~/.apm/config.json` 中设置 `"http": { "enabled": true, "port": 19740 }`，或通过桌面应用「设置」保存）。

2. 启动 daemon（终端 1）：

```bash
npm run dev:daemon
```

记下启动日志中的 `apm http api http://127.0.0.1:19740` 与 `~/.apm/state/http.token` 内容。

3. 启动桌面前端（终端 2）：

```bash
export APM_DESKTOP_DEV=1
export APM_HTTP_URL=http://127.0.0.1:19740
export APM_HTTP_TOKEN=$(cat ~/.apm/state/http.token)
npm run desktop:install
npm run desktop:dev
```

`APM_DESKTOP_DEV=1` 时不会自动 spawn sidecar，而是连接上述已运行的 daemon。

### 构建安装包

先构建当前平台的 `apm-daemon` 二进制并放入 Tauri sidecar 路径，再打包桌面应用：

```bash
npm run build:bin
# 将 dist/bin/apm-daemon-<platform> 复制为 apps/apm-desktop/src-tauri/bin/apm-daemon-<target-triple>
npm run desktop:build
```

### HTTP API

Daemon 在 `127.0.0.1` 提供 REST + SSE（需 Bearer token 或 `?token=` 用于 EventSource）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查（无需 token） |
| GET | `/runs` | 列表 |
| POST | `/runs` | 启动 run |
| GET | `/runs/:id` | 单条 run |
| GET | `/runs/:id/logs` | 日志 |
| GET | `/runs/:id/events/stream` | SSE 事件流 |
| GET/POST | `/runs/:id/attach/*` | Attach/HITL |
| GET | `/catalog` | 配置目录索引 |
| GET/PUT | `/config` | 读写 config.json |

## SEA 兼容说明

- 跨平台二进制需在对应 OS/arch runner 上构建；`build:bin:all` 在单机环境下只会成功构建当前平台 target。
- `@cursor/sdk` 依赖平台包中的 `rg` / `cursorsandbox` 与 `sqlite3` 原生 binding；构建前请在本机执行 `npm ci` 确保 optionalDependencies 完整。
- SSH 能力依赖 `ssh2`（已打入 apm-daemon bundle）；远程 host 仍需独立安装 `node` 与 `@cursor/sdk`。
- 开发调试可继续使用 `npm run dev:daemon`（tsx + 源码），无需每次重建 SEA。
