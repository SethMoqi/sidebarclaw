# 实现说明

## 目标

这个项目当前的核心目标有两条：

1. 作为本地 `OpenClaw` 的网页工作台使用
2. 在 `OpenClaw` 不可用时，提供长文注入、检索和证据回答的 fallback

## 需求演进

本次实现是沿着下面这条路径收敛的：

1. 先做长文处理 MVP，解决“整篇长文无法一次性塞进上下文”的问题
2. 增加本地 HTTP gateway，把注入、问答、摘要和归档暴露成插件可调用接口
3. 增加多轮会话，支持注入后继续追问
4. 把产品定位调整为本地 `OpenClaw` 工作台，而不是单纯的 longdoc 演示页
5. 增加 `agent` 指定能力
6. 将 `OpenClaw Base URL` 和 `Bearer Token` 与输入/会话物理隔离
7. 增加 Chromium 试验插件，用于实际环境联调

## 当前实现

### 1. Gateway

`src/longdoc/gateway.py` 提供以下能力：

- 静态页面服务：`/`、`/app.css`、`/app.js`
- 会话接口：`POST /sessions/create`、`GET /sessions/:id`
- 设置接口：`GET/POST /settings/openclaw`、`GET /settings/schema`
- 校验接口：`POST /openclaw/validate`
- 工作接口：`POST /inputs/inject`、`POST /ask`、`POST /summarize/page`、`POST /archive/create`

### 2. OpenClaw 适配

根据当前运行中的 OpenClaw Control UI 和本地 bundle 检查，官方聊天机制是 Gateway WebSocket RPC，而不是单纯的 `/v1/responses` 页面聊天：

- 连接阶段包含 `connect`
- 聊天相关方法至少包含 `chat.history`
- 聊天发送至少包含 `chat.send`

当前试验版仍保留基于 HTTP adapter 的实现，主要原因是先把插件工作流和本地 fallback 跑通。现阶段行为是：

- 配置独立保存
- 聊天和页面注入仍通过本地 adapter HTTP 链路进入 gateway
- adapter 内部优先调用官方 `openclaw gateway call chat.send/chat.history`
- 若未显式填写 Token，优先复用 `OPENCLAW_GATEWAY_TOKEN`
- 如果官方链路失败且允许 fallback，再退回本地 longdoc

### 3. 安全隔离

为降低 API 泄露风险，连接信息和输入数据分开存储：

- `baseUrl`、`bearerToken` 只保存在独立设置存储
- `session` 不保存上述敏感字段
- 会话和输入链路只保留公共配置，例如 `model`、`agent`、`fallbackToLocal`
- 旧会话在读取和保存时会做脱敏

### 4. 前端

前端分成两层：

- `web/`：本地浏览器工作台
- `extension/`：Chromium 试验插件

插件又拆成两个入口：

- `sidepanel.html`：对话、注入、会话操作
- `options.html`：Gateway/OpenClaw 设置和连接验证

这样可以把密钥配置和网页输入视图分开。侧栏不再承载配置编辑，只保留交流页面。

### 5. longdoc fallback

fallback 的处理链路包括：

- 入库清洗：`ingest.py`
- 分块：`chunking.py`
- 索引：`indexing.py`
- 证据回答：`qa.py`

当前适合做本地证据检索和结构化返回，不以大模型生成质量为目标。

## 已完成的关键点

- 长文输入入库与 JSON 抓取结果兼容
- 会话持久化与当前活动文档记录
- `agent` 指定能力
- `OpenClaw` 设置独立存储
- 设置校验和缓解提示
- 试验插件侧栏与独立选项页

## 当前限制

- 插件前端本身还没有直接持有官方 WebSocket 客户端；目前是通过本地 adapter 代连 `connect/chat.history/chat.send`
- 还没有向量检索和 rerank
- 还没有插件侧的归档页和任务模板
- 还没有针对真实 OpenClaw 返回结构做充分联调

## 建议的后续工作

1. 用真实本地 `OpenClaw` 地址和 token 做一次端到端联调
2. 按真实返回结构收紧 `/v1/responses` 适配
3. 如果多轮能力需要更强，再接 WebSocket 协议
4. 再决定是否补向量检索、归档页和任务模板
