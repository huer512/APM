# APM（Agent Pipline Manager）需求说明

本文档用于完整记录 APM 的目标、目录规范、运行方式与交互要求，作为后续实现计划与开发验收基线。

## 1. 目录与配置规范

项目目录格式如下：

```text
prompts/
stages/
hosts/
entries/
src/
dist/
```

### 1.1 `prompts/`：提示词目录

- 存放所有提示词文件，格式为 Markdown（`.md`）。
- 一个 prompt 对应一个 agent。
- 执行时按 prompt 名称在该目录或其子目录中读取对应 Markdown 文件。
- 支持在提示词中引用之前 prompt 的输出，引用格式包括：
  - `{abc}`
  - `{stage_name.abc}`
  - `{abc[0]}`
  - `{abc[-1]}`
  - `{stage_name.abc[2]}`
- 含义说明：
  - `abc`：引用名为 `abc` 的 prompt 输出。
  - `stage_name.abc`：限定某个阶段中的 `abc` 输出。
  - `[index]`：按执行历史索引读取对应输出，支持负索引（如 `-1` 代表最后一次）。
- 支持 frontmatter 元数据，元数据不作为提示词正文传给 agent。
- 元数据中的 `model` 可指定模型，不指定时默认 `auto`。
- 元数据中的 `skills` 可指定是否加载 project 级 Cursor 配置（`.cursor/skills/`、rules、project MCP 等）。为 `true` / `on` / `yes` 时启用；省略或为 `false` 时不加载（默认）。
- 元数据也支持变量注入。

示例：

```md
---
model: GPT-5.5
skills: true
---
xxxxxx(这里是提示词正文)
```

### 1.2 `stages/`：阶段定义目录

- 存放每个流程阶段的提示词调用配置，格式为 Markdown。
- 文件结构：
  - `## 提示词`：列出本阶段要执行的 prompt 名称（每行一个 `-` 项）。
  - `## 后继阶段`：列出本阶段完成后的后继阶段（每行一个 `-` 项）。
- 后继阶段规则：
  - 有 2 个或更多：并行执行。
  - 有 1 个：串行执行。
- 同样支持引用之前的提示词输出。

示例：

```md
## 提示词
- aaa
- bbb
- ccc
- ...（一点一个）
## 后继阶段
- a_stage
- b_stage
- ... （有两个则并行，有1个则串行）
```

### 1.3 `hosts/`：执行主机目录

- 用于指定 Agent 运行设备、工作目录与虚拟环境，格式为 Markdown + frontmatter。
- 字段说明：
  - `host`：目标主机地址。若为 `localhost`，默认当前设备。
  - `port`：SSH 端口。
  - `username` / `password`：SSH 登录信息。
  - `workspace`：
    - 绝对路径：作为 agent 工作目录；
    - 相对路径：本机执行脚本目录的相对路径，或 SSH 登录后默认家目录下的相对路径；
    - 若目录不存在则创建。
- 若 `localhost` 且无特殊需求，可不指定端口用户名密码；若指定了本机端口，表示需 SSH 连接本机该端口（例如本机虚拟机）。

示例：

```md
---
host: 192.168.1.2 #如果是localhost，则为当前设备，无需指定端口用户名密码，除非指定了端口（指定端口的意思是要连接到本机上的某个端口ssh，比如可能在本机开了虚拟机）
port: 22
username: root
password: 123456
workspace: /root/workspace_dir #如果是绝对路径，为Agent的工作目录；如果是相对路径，则为本机执行脚本所在目录的相对路径，或是ssh连入后默认家目录下的相对路径，如果文件夹不存在则创建
---
```

### 1.4 `entries/`：工作流入口目录

- 用于定义工作流信息、入口阶段与默认参数，格式为 Markdown + frontmatter。
- frontmatter 用于声明：
  - `entry`：入口阶段（如 `stage_a`）
  - `host`：默认执行主机（如 `my_host1`）
  - 其他任意参数及其默认值（如 `variable_name1: null`、`variable_name2: xxxx`）。
- 这些参数支持在 prompt 中注入。
- Markdown 正文用于记录工作流说明文档。

示例：

```md
---
entry: stage_a
host: my_host1
variable_name1: null #设置可传入参数variable_name1，默认值为空
variable_name2: xxxx #设置参数variable_name2，默认值为xxx
xxx: xxx #可设置各种传入参数
---
# xxxx
## xxxx
...（工作流信息）
```

### 1.5 `src/` 与 `dist/`

- `src/`：引擎源代码目录。
- `dist/`：引擎打包后的 CLI 二进制文件目录。

## 2. 运行架构：`apm daemon` + `apm cli`

### 2.1 基本机制

- 运行前先启动 `apm daemon`，监听本地 socket。
- 使用 `apm cli` 对工作流进行管理、运行、调试。

### 2.2 CLI 命令示例（类比 Docker）

```bash
apm run -d entry1 #后台运行entry1
apm run -d entry2 -p variable1=value1 #后台运行entry2并传参
apm run -a entry1 #启动 entry1 并立即 attach 进入 HITL 交互
apm logs 44b770cbe172 #查看ID为44b770cbe172的执行日志（人类可读）
apm logs 44b770cbe172 --json #输出结构化 JSONL 事件
apm logs 44b770cbe172 --follow #跟随新事件直到 run 结束
apm logs 44b770cbe172 --kind tool #仅查看 tool 事件
apm ps #查看运行的工作流实例
apm ps -a #查看所有工作流，包含已暂停的
apm attach 44b770cbe172 #进入正在运行的工作流
```

## 3. Human-in-the-loop 控制

### 3.1 Attach 后的交互能力

- 可通过 CLI `attach` 到正在执行的工作流实例。
- attach 后提供 TUI 页面，展示：
  - 每个 prompt 的消息历史（含 tool/thinking）；
  - Tool Events 面板（SDK tool_call 结构化事件）；
  - 每个阶段的消息历史；
  - 当前正在执行的 prompt。
- 用户可在当前阶段执行中介入，例如向某个 agent 发送消息。

### 3.2 阶段推进策略

- 当处于 attach 模式时：
  - 当前阶段执行结束后，不自动进入下一阶段；
  - 需等待用户显式操作后再进入下一阶段；
  - 进入下一阶段前，用户可继续与当前阶段 prompt 的 agent 交流。

## 4. 约束与术语

- 名称：Agent Pipline Manager，简称 APM（按原需求拼写保留为 “Pipline”）。
- 运行事件以 JSONL 存储于 `~/.apm/state/events/{runId}.jsonl`，为唯一真相源；`apm logs` 从此渲染人类可读文本。
- SDK `tool_call` 事件写入结构化日志，并可在 attach / `--kind tool` 中查看。
- 核心目标：基于 Cursor SDK 构建可配置、可编排、可观测、可人工干预的 Agent Pipeline 系统。
