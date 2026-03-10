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

当前优先适配官方 `POST /v1/responses`：

- 透传 `model`
- 使用 `Authorization: Bearer ...`
- 将 `agent` 写入 `metadata` 和 `instructions`
- 如果远端失败且允许 fallback，则退回本地 longdoc 检索链路

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

这样可以把密钥配置和网页输入视图分开。

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

- 还没有接真实的 WebSocket `chat.send/chat.inject`
- 还没有向量检索和 rerank
- 还没有插件侧的归档页和任务模板
- 还没有针对真实 OpenClaw 返回结构做充分联调

## 建议的后续工作

1. 用真实本地 `OpenClaw` 地址和 token 做一次端到端联调
2. 按真实返回结构收紧 `/v1/responses` 适配
3. 如果多轮能力需要更强，再接 WebSocket 协议
4. 再决定是否补向量检索、归档页和任务模板
