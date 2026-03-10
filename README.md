# longdoc-mvp

一个面向本地 `OpenClaw` 的长文工作台，提供本地 gateway、网页侧栏插件和长文检索 fallback。

## 功能

- 连接本地 `OpenClaw`
- 指定 `model` 和 `agent`
- 通过独立设置页保存 `OpenClaw Base URL` 与 `Bearer Token`
- 将当前网页注入到会话中并继续多轮提问
- 支持选择多个打开的标签页一起注入
- 支持 `抓取正文` 与 `只注入 URL 引用` 两种注入模式
- 支持配置默认注入提示词和默认提问前缀
- 当 `OpenClaw` 不可用时，回退到本地 longdoc 检索链路
- 支持本地文档或网页抓取 JSON 的入库、切块、检索和证据输出

## 组成

- 本地 gateway：`src/longdoc/gateway.py`
- Web 工作台：`web/`
- Chromium 试验插件：`extension/`
- 本地 longdoc CLI：`src/longdoc/cli.py`

## 快速开始

先启动本地 gateway：

```bash
PYTHONPATH=src python3 -m longdoc.gateway --port 8787 --data-dir .gateway_data
```

如果系统默认 `python3` 低于 3.11，改用启动脚本：

```bash
scripts/start_gateway.sh --port 8787 --data-dir .gateway_data
```

然后访问：

```text
http://127.0.0.1:8787/
```

## 插件测试步骤

1. 启动 gateway：`PYTHONPATH=src python3 -m longdoc.gateway --port 8787 --data-dir .gateway_data`
2. 打开 `chrome://extensions` 或 `edge://extensions`
3. 开启开发者模式
4. 选择“加载已解压的扩展程序”
5. 选择目录：`/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/extension`
6. 打开扩展详情页中的“扩展程序选项”
7. 保存 `Gateway Base URL`
8. 保存 `OpenClaw Base URL`、`Bearer Token`、`Model`、`Agent`
9. 点击“测试连接”
10. 在设置页保存默认注入提示词、默认提问前缀和默认注入模式
11. 打开侧栏，选择一个或多个标签页并注入
12. 在侧栏继续提问

## CLI 示例

```bash
PYTHONPATH=src python3 -m longdoc.cli ingest sample_article.md --output .longdoc_index
PYTHONPATH=src python3 -m longdoc.cli ask "miR-122 和 circFOXO3 的关系" --index .longdoc_index
PYTHONPATH=src python3 -m longdoc.cli summarize --index .longdoc_index
PYTHONPATH=src python3 -m longdoc.cli inject sample_capture.json --output .longdoc_index_json
```

## 当前限制

- 不负责联网抓取网页
- 本地 fallback 仍以词法检索为主，不含向量召回和 rerank
- 根据当前运行中的 OpenClaw Control UI，官方聊天机制是 Gateway WebSocket RPC，至少包含 `connect`、`chat.history`、`chat.send`
- 当前试验插件通过本地 adapter HTTP 链路工作，但 adapter 内部已经切到官方 `openclaw gateway call chat.send/chat.history`
- 若未在设置页显式填写 Token，adapter 会优先复用 `OPENCLAW_GATEWAY_TOKEN`

## 相关文档

- 需求说明：[/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/REQUIREMENTS.md](/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/REQUIREMENTS.md)
- 实现说明与需求演进：[/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/IMPLEMENTATION.md](/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/IMPLEMENTATION.md)
