# longdoc-mvp

一个可直接运行的长文处理 MVP，目标是避免把整篇长文一次性塞进模型。

当前版本支持：

- 本地 `txt`、`md`、`html` 文档清洗和入库
- 抓取结果 JSON 入库，兼容带 `output.summary` / `excerpt` 的网页快照
- `inputs/inject` 风格注入响应，本地保存输入记录
- 本地 HTTP 网关，提供 `POST /inputs/inject`、`POST /ask`、`POST /summarize/page`、`POST /archive/create`
- 可配置本地 `OpenClaw Base URL`
- 可配置 `Bearer Token`
- 可配置 `Model`
- 可指定 `agent`
- OpenClaw 不可用时可回退到本地 longdoc 能力
- 按标题和段落切块
- 基于 BM25 风格打分的本地检索
- section 级摘要输出
- 返回带段落定位的证据摘要
- `ask --json` 输出结构化证据包，便于插件调用

## Quick start

```bash
python3 -m longdoc.cli ingest sample_article.md --output .longdoc_index
python3 -m longdoc.cli ask "circFOXO3 和 miR-122 有什么关系" --index .longdoc_index
python3 -m longdoc.cli summarize --index .longdoc_index
python3 -m longdoc.cli inject sample_capture.json --output .longdoc_index_json
PYTHONPATH=src python3 -m longdoc.gateway --port 8787 --data-dir .gateway_data
```

如果不想安装包，可以直接用源码路径运行：

```bash
PYTHONPATH=src python3 -m longdoc.cli ingest sample_article.md --output .longdoc_index
PYTHONPATH=src python3 -m longdoc.cli ask "哪些基因和胆固醇合成有关" --index .longdoc_index
PYTHONPATH=src python3 -m longdoc.cli ask "miR-122 和 circFOXO3 的关系" --index .longdoc_index_json --json
PYTHONPATH=src python3 -m longdoc.cli summarize --index .longdoc_index
PYTHONPATH=src python3 -m longdoc.cli inject sample_capture.json --output .longdoc_index_json
PYTHONPATH=src python3 -m longdoc.gateway --port 8787 --data-dir .gateway_data
```

启动后直接打开：

```text
http://127.0.0.1:8787/
```

页面右侧支持配置：

- `OpenClaw Base URL`：本地 OpenClaw 服务地址
- `Bearer Token`：调用 OpenClaw 官方 `/v1/responses` 所需认证
- `Model`：例如 `openclaw:main`
- `Agent`：本次网页注入和提问要指定的 agent
- `OpenClaw 失败时回退到本地 longdoc`：适合本地调试

当前专用适配路径：

- 优先调用 OpenClaw 官方 `POST /v1/responses`
- 请求里会带上 `model`、`Authorization: Bearer ...`
- `agent` 会作为元数据和 instructions 一起传入
- 若官方接口失败且开启 fallback，则退回本地 longdoc 检索链路

注入接口示例：

```bash
curl -X POST http://127.0.0.1:8787/inputs/inject \
  -H 'content-type: application/json' \
  -d @sample_capture.json
```

问答接口示例：

```bash
curl -X POST http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{"question":"miR-122 和 circFOXO3 的关系","indexRef":{"docId":"sample_capture"}}'
```

## Project layout

```text
src/longdoc/ingest.py
src/longdoc/chunking.py
src/longdoc/indexing.py
src/longdoc/qa.py
src/longdoc/cli.py
extension/
```

## Experimental Extension

仓库现在包含一个可侧载测试的 Chromium 插件：

```text
extension/manifest.json
extension/background.js
extension/sidepanel.html
extension/sidepanel.css
extension/sidepanel.js
```

加载方式：

1. 先启动本地 gateway：`PYTHONPATH=src python3 -m longdoc.gateway --port 8787 --data-dir .gateway_data`
2. 打开 `chrome://extensions` 或 `edge://extensions`
3. 开启开发者模式
4. 选择“加载已解压的扩展程序”
5. 选择目录：`/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/extension`

插件功能：

- 独立 `options` 设置页，用于保存 gateway 与 OpenClaw 配置
- 配置 `Gateway Base URL`
- 通过 gateway 设置和校验 OpenClaw 连接
- 注入当前页面到当前会话
- 在侧栏继续提问
- 复用当前会话和指定 agent

推荐测试流程：

1. 加载扩展后先打开扩展详情页里的“扩展程序选项”
2. 在设置页保存 `Gateway Base URL`
3. 在设置页保存 `OpenClaw Base URL`、`Bearer Token`、`Model`、`Agent`
4. 先点击“测试连接”，确认校验结果和缓解建议
5. 再打开侧栏，创建新会话并注入当前页面

## Pipeline

1. `ingest`: 读取原文，做基础清洗，解析标题和 section。
2. `gateway`: 提供本地 HTTP API，把注入、问答、摘要、归档串成插件可调用的链路。
3. `inject`: 按 OpenClaw 输入注入格式保存网页/长文输入，并生成注入回执。
4. `chunking`: 按 section 和段落切成可检索块。
5. `indexing`: 构建本地检索索引并落盘。
6. `summarize`: 输出按 section 聚合的摘要。
7. `ask`: 检索相关 chunk，输出结论和引用位置，或结构化证据 JSON。

## Limitations

- 现在只做本地文档，不含网页抓取。
- 现在支持网页抓取结果 JSON 入库，但不负责联网抓取。
- 现在是词法检索，不含向量召回和 rerank。
- 现在的“摘要”和“答案”都是规则化证据拼装，不是大模型生成。
- 现在优先作为 `OpenClaw` 工作台使用；若本地 OpenClaw API 不可用，可退回到本地 longdoc 检索骨架。
- 已实现 OpenClaw 官方 `/v1/responses` 专用适配，但还没有做 WebSocket `chat.send/chat.inject`、任务模板编辑器和归档检索页。

这个版本适合先把长文处理链路跑通，后续再接网页抓取、embedding、LLM 总结。 
