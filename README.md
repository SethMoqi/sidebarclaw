# longdoc-mvp

一个面向本地 `OpenClaw` 的长文工作台，提供本地 gateway、网页侧栏插件和长文检索 fallback。

## 功能

- 连接本地 `OpenClaw`
- 指定 `model` 和 `agent`
- 通过独立设置页保存 `OpenClaw Base URL` 与 `Bearer Token`
- 将当前网页注入到会话中并继续多轮提问
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
10. 打开侧栏，创建新会话并注入当前页面

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
- `OpenClaw` 当前优先走官方 `/v1/responses` 适配，尚未接入 WebSocket `chat.send/chat.inject`

## 相关文档

- 需求说明：[/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/REQUIREMENTS.md](/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/REQUIREMENTS.md)
- 实现说明与需求演进：[/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/IMPLEMENTATION.md](/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/docs/IMPLEMENTATION.md)
