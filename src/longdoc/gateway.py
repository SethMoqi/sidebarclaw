from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import subprocess
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mimetypes import guess_type
from pathlib import Path
from urllib.parse import urlparse

from .chunking import build_chunks
from .indexing import LongDocIndex, load_index, save_input_record
from .ingest import ingest_document, ingest_text
from .qa import answer_question_json, build_injected_output, summarize_document


def _slug(value: str) -> str:
    lowered = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return lowered or f"doc-{int(datetime.now(UTC).timestamp())}"


def _build_document_from_payload(body: dict):
    input_payload = body.get("input", {})
    page = body.get("page", {})
    content = str(
        input_payload.get("content")
        or page.get("content")
        or body.get("content")
        or ""
    ).strip()
    title = str(input_payload.get("title") or page.get("title") or body.get("title") or "Untitled document").strip()
    source = str(input_payload.get("url") or page.get("url") or body.get("url") or "").strip()
    instruction = str(input_payload.get("instruction") or body.get("instruction") or "").strip()
    if not content:
        raise ValueError("content is required")
    doc = ingest_text(
        content,
        doc_id=_slug(title),
        source=source or f"inline:{_slug(title)}",
    )
    if title:
        doc.title = title
        if doc.section_titles:
            doc.section_titles[0] = title
    return doc, content, instruction, input_payload, page


def _archive_path(data_dir: Path) -> Path:
    return data_dir / "archives.json"


def _session_path(data_dir: Path, session_id: str) -> Path:
    return data_dir / "sessions" / f"{session_id}.json"


def _openclaw_settings_path(data_dir: Path) -> Path:
    return data_dir / "settings" / "openclaw.json"


def _load_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json_list(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def _default_openclaw_settings() -> dict:
    return {
        "baseUrl": "",
        "bearerToken": "",
        "model": "openclaw:main",
        "agent": "",
        "fallbackToLocal": True,
    }


def _load_openclaw_settings(data_dir: Path) -> dict:
    path = _openclaw_settings_path(data_dir)
    if not path.exists():
        return _default_openclaw_settings()
    stored = json.loads(path.read_text(encoding="utf-8"))
    return {**_default_openclaw_settings(), **stored}


def _save_openclaw_settings(data_dir: Path, config: dict) -> dict:
    normalized = {**_default_openclaw_settings(), **config}
    path = _openclaw_settings_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def _public_openclaw_settings(config: dict) -> dict:
    return {
        "baseUrl": config.get("baseUrl", ""),
        "model": config.get("model", "openclaw:main"),
        "agent": config.get("agent", ""),
        "fallbackToLocal": bool(config.get("fallbackToLocal", True)),
        "hasBearerToken": bool(config.get("bearerToken") or os.getenv("OPENCLAW_GATEWAY_TOKEN")),
    }


def _public_openclaw_runtime_status(payload: dict) -> dict:
    return {
        "mode": payload.get("mode", ""),
        "model": payload.get("model", ""),
        "agent": payload.get("agent", ""),
        "error": payload.get("error", ""),
    }


def _create_session(data_dir: Path) -> dict:
    session = {
        "id": f"ses_{secrets.token_hex(6)}",
        "createdAt": datetime.now(UTC).isoformat(),
        "updatedAt": datetime.now(UTC).isoformat(),
        "openclaw": {
            "model": "openclaw:main",
            "agent": "",
            "fallbackToLocal": True,
            "configRef": "default",
        },
        "activeIndexRef": None,
        "activeDocument": None,
        "documentSummary": None,
        "documentStats": None,
        "turns": [],
    }
    _save_session(data_dir, session)
    return session


def _load_session(data_dir: Path, session_id: str) -> dict:
    path = _session_path(data_dir, session_id)
    if not path.exists():
        raise FileNotFoundError(f"session not found: {session_id}")
    return _sanitize_session(json.loads(path.read_text(encoding="utf-8")))


def _save_session(data_dir: Path, session: dict) -> None:
    session = _sanitize_session(session)
    session["updatedAt"] = datetime.now(UTC).isoformat()
    path = _session_path(data_dir, session["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_turn(session: dict, *, role: str, text: str, extra: dict | None = None) -> None:
    turn = {
        "id": f"turn_{secrets.token_hex(5)}",
        "role": role,
        "text": text,
        "createdAt": datetime.now(UTC).isoformat(),
    }
    if extra:
        turn.update(extra)
    session.setdefault("turns", []).append(turn)


def _sanitize_turn_text(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("{"):
        return text
    try:
        payload = json.loads(stripped)
    except Exception:
        return text
    if isinstance(payload, dict) and "openclaw" in payload and isinstance(payload["openclaw"], dict):
        payload["openclaw"] = _public_openclaw_runtime_status(payload["openclaw"])
        return json.dumps(payload, ensure_ascii=False, indent=2)
    return text


def _sanitize_session(session: dict) -> dict:
    openclaw = session.get("openclaw") or {}
    session["openclaw"] = {
        "model": openclaw.get("model", "openclaw:main"),
        "agent": openclaw.get("agent", ""),
        "fallbackToLocal": bool(openclaw.get("fallbackToLocal", True)),
        "configRef": openclaw.get("configRef", "default"),
    }
    for turn in session.get("turns", []):
        if "text" in turn and isinstance(turn["text"], str):
            turn["text"] = _sanitize_turn_text(turn["text"])
    return session


def _normalize_openclaw_config(payload: dict | None) -> dict:
    payload = payload or {}
    return {
        "baseUrl": str(payload.get("baseUrl") or "").rstrip("/"),
        "bearerToken": str(payload.get("bearerToken") or "").strip(),
        "model": str(payload.get("model") or "openclaw:main").strip() or "openclaw:main",
        "agent": str(payload.get("agent") or "").strip(),
        "fallbackToLocal": bool(payload.get("fallbackToLocal", True)),
    }


def _resolve_openclaw_runtime_config(data_dir: Path, payload: dict | None) -> dict:
    stored = _load_openclaw_settings(data_dir)
    override = payload or {}
    return {
        "baseUrl": stored.get("baseUrl", ""),
        "bearerToken": stored.get("bearerToken") or os.getenv("OPENCLAW_GATEWAY_TOKEN", ""),
        "model": str(override.get("model") or stored.get("model") or "openclaw:main"),
        "agent": str(override.get("agent") or stored.get("agent") or ""),
        "fallbackToLocal": bool(override.get("fallbackToLocal", stored.get("fallbackToLocal", True))),
    }


def _normalize_gateway_ws_url(base_url: str) -> str:
    parsed = urlparse(base_url.strip())
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("OpenClaw Gateway URL 必须是有效的 http(s) 或 ws(s) 地址。")
    if parsed.scheme == "http":
        scheme = "ws"
    elif parsed.scheme == "https":
        scheme = "wss"
    elif parsed.scheme in {"ws", "wss"}:
        scheme = parsed.scheme
    else:
        raise ValueError("OpenClaw Gateway URL 只支持 http、https、ws、wss。")
    path = parsed.path or ""
    return f"{scheme}://{parsed.netloc}{path}"


def _gateway_session_key(session_id: str, agent: str) -> str:
    if agent:
        return f"agent:{agent}:{session_id}"
    return session_id


def _call_openclaw_gateway(*, openclaw: dict, method: str, params: dict, expect_final: bool = False, timeout_ms: int = 20000) -> dict:
    gateway_url = _normalize_gateway_ws_url(openclaw["baseUrl"])
    command = [
        "openclaw",
        "gateway",
        "call",
        method,
        "--url",
        gateway_url,
        "--json",
        "--timeout",
        str(timeout_ms),
        "--params",
        json.dumps(params, ensure_ascii=False),
    ]
    token = str(openclaw.get("bearerToken") or os.getenv("OPENCLAW_GATEWAY_TOKEN") or "").strip()
    if token:
        command.extend(["--token", token])
    if expect_final:
        command.append("--expect-final")
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise ValueError(detail or f"OpenClaw gateway call failed: {method}")
    stdout = result.stdout.strip()
    if not stdout:
        return {}
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ValueError(f"OpenClaw gateway returned invalid JSON for {method}: {stdout}") from exc


def _build_sidebar_text(*, title: str, url: str, selected_text: str, content: str) -> str:
    parts = [f"Title: {title}", f"URL: {url}"]
    if selected_text:
        parts.append(f"SelectedText: {selected_text}")
    parts.append(f"PageContent:\n{content}")
    return "\n".join(parts)


def _build_inject_message(*, openclaw: dict, sidebar_text: str, instruction: str) -> str:
    lines = [
        "请将下面网页内容作为当前会话的上下文保存，供后续问题使用。",
        "不要总结，不要解释，不要提问。",
        "完成后只回复：NO_REPLY",
    ]
    if openclaw.get("agent"):
        lines.append(f"当前优先 agent: {openclaw['agent']}")
    if instruction:
        lines.append(f"附加要求: {instruction}")
    lines.extend(["", sidebar_text])
    return "\n".join(lines)


def _build_question_message(question: str) -> str:
    return question.strip()


def _extract_gateway_message_text(payload: dict) -> str:
    if isinstance(payload.get("text"), str) and payload["text"].strip():
        return payload["text"].strip()
    content = payload.get("content")
    if isinstance(content, list):
        texts = []
        for part in content:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
        if texts:
            return "\n\n".join(texts)
    message = payload.get("message")
    if isinstance(message, dict):
        return _extract_gateway_message_text(message)
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _fetch_gateway_history(*, openclaw: dict, session_key: str, limit: int = 20) -> dict:
    return _call_openclaw_gateway(
        openclaw=openclaw,
        method="chat.history",
        params={"sessionKey": session_key, "limit": limit},
        timeout_ms=10000,
    )


def _send_gateway_message_and_wait(*, openclaw: dict, session_key: str, message: str, idempotency_key: str, timeout_s: float = 20.0) -> dict:
    before = _fetch_gateway_history(openclaw=openclaw, session_key=session_key, limit=200)
    before_messages = before.get("messages") if isinstance(before.get("messages"), list) else []
    before_count = len(before_messages)
    send_result = _call_openclaw_gateway(
        openclaw=openclaw,
        method="chat.send",
        params={
            "sessionKey": session_key,
            "message": message,
            "deliver": False,
            "idempotencyKey": idempotency_key,
        },
        expect_final=True,
        timeout_ms=20000,
    )
    deadline = time.time() + timeout_s
    latest_history = before
    while time.time() < deadline:
        latest_history = _fetch_gateway_history(openclaw=openclaw, session_key=session_key, limit=200)
        messages = latest_history.get("messages") if isinstance(latest_history.get("messages"), list) else []
        if len(messages) > before_count:
            last_message = messages[-1]
            if isinstance(last_message, dict) and str(last_message.get("role") or "").lower() == "assistant":
                return {
                    "run": send_result,
                    "history": latest_history,
                    "message": last_message,
                }
        time.sleep(0.35)
    return {
        "run": send_result,
        "history": latest_history,
        "message": None,
    }


def _validate_openclaw_config(config: dict) -> dict:
    normalized = _normalize_openclaw_config(config)
    mitigations: list[str] = []
    checks: list[dict] = []

    if normalized["baseUrl"]:
        try:
            ws_url = _normalize_gateway_ws_url(normalized["baseUrl"])
            checks.append({"name": "baseUrl", "status": "ok", "message": f"Gateway URL 格式有效，将使用 {ws_url}。"})
        except ValueError as exc:
            checks.append({"name": "baseUrl", "status": "error", "message": str(exc)})
            mitigations.append("将 Gateway URL 改成类似 http://127.0.0.1:17562/3bb02e13 或 ws://127.0.0.1:17562/3bb02e13 的地址。")
        else:
            pass
    else:
        checks.append({"name": "baseUrl", "status": "warn", "message": "未配置 OpenClaw Base URL，将只使用本地 fallback。"})
        mitigations.append("如果要连接真实 OpenClaw，请填写本地 Gateway Base URL。")

    effective_token = normalized["bearerToken"] or os.getenv("OPENCLAW_GATEWAY_TOKEN", "")
    if normalized["baseUrl"] and not effective_token:
        checks.append({"name": "bearerToken", "status": "warn", "message": "未提供 Gateway Token，也没有检测到 OPENCLAW_GATEWAY_TOKEN。"})
        mitigations.append("在设置中填入 Gateway Token，或在启动 gateway 的环境中设置 OPENCLAW_GATEWAY_TOKEN。")
    elif normalized["bearerToken"]:
        checks.append({"name": "bearerToken", "status": "ok", "message": "Gateway Token 已提供。"})
    elif effective_token:
        checks.append({"name": "bearerToken", "status": "ok", "message": "检测到 OPENCLAW_GATEWAY_TOKEN，可直接复用。" })

    if normalized["model"]:
        checks.append({"name": "model", "status": "ok", "message": f"Model: {normalized['model']}"})
    else:
        checks.append({"name": "model", "status": "error", "message": "Model 不能为空。"})
        mitigations.append("将 Model 设为可用模型名，例如 openclaw:main。")

    if normalized["agent"]:
        checks.append({"name": "agent", "status": "ok", "message": f"Agent: {normalized['agent']}"})
    else:
            checks.append({"name": "agent", "status": "warn", "message": "未指定 agent，将由 OpenClaw 默认策略处理。"})
            mitigations.append("如果有固定工作流，建议明确填写 agent。")

    if normalized["baseUrl"]:
        try:
            health = _call_openclaw_gateway(
                openclaw={**normalized, "bearerToken": effective_token},
                method="health",
                params={},
                timeout_ms=6000,
            )
            checks.append({"name": "connectivity", "status": "ok", "message": f"Gateway WebSocket 连通成功。{json.dumps(health, ensure_ascii=False)}"})
        except Exception as exc:
            checks.append({"name": "connectivity", "status": "warn", "message": f"未能验证 Gateway WebSocket 连通性: {exc}"})
            mitigations.append("确认本地 OpenClaw Gateway 已启动，并检查 URL 路径、Token 和端口。")

    status = "ok"
    if any(item["status"] == "error" for item in checks):
        status = "error"
    elif any(item["status"] == "warn" for item in checks):
        status = "warn"

    messages = {
        "ok": "配置校验通过，可以尝试连接本地 OpenClaw。",
        "warn": "配置可保存，但存在风险项，建议先处理缓解建议。",
        "error": "配置存在阻断问题，建议先修正后再使用。",
    }
    return {
        "valid": status != "error",
        "status": status,
        "message": messages[status],
        "checks": checks,
        "mitigations": mitigations,
        "normalized": _public_openclaw_settings(normalized),
    }


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = "LongDocGateway/0.1"

    def do_OPTIONS(self) -> None:
        self._write_json(200, {"ok": True})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            return self._serve_static("index.html")
        if parsed.path in {"/app.css", "/app.js"}:
            return self._serve_static(parsed.path.lstrip("/"))
        if parsed.path == "/settings/schema":
            return self._write_json(200, {
                "fields": [
                    {"id": "baseUrl", "label": "OpenClaw Gateway URL", "type": "url", "required": False},
                    {"id": "bearerToken", "label": "Gateway Token", "type": "password", "required": False},
                    {"id": "model", "label": "Model", "type": "text", "required": True},
                    {"id": "agent", "label": "Agent", "type": "text", "required": False},
                    {"id": "fallbackToLocal", "label": "Fallback To Local", "type": "boolean", "required": True},
                ],
                "defaults": {
                    "model": "openclaw:main",
                    "fallbackToLocal": True,
                },
            })
        if parsed.path == "/settings/openclaw":
            return self._write_json(200, {"settings": _public_openclaw_settings(_load_openclaw_settings(self.data_dir))})
        if parsed.path.startswith("/sessions/"):
            session_id = parsed.path.rsplit("/", 1)[-1]
            return self._write_json(200, {"session": _load_session(self.data_dir, session_id)})
        if parsed.path == "/health":
            self._write_json(200, {"status": "ok", "time": datetime.now(UTC).isoformat()})
            return
        self._write_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
            if parsed.path == "/inputs/inject":
                return self._handle_inject(body)
            if parsed.path == "/sessions/create":
                return self._handle_create_session()
            if parsed.path == "/settings/openclaw":
                return self._handle_save_openclaw_settings(body)
            if parsed.path == "/openclaw/validate":
                return self._handle_openclaw_validate(body)
            if parsed.path == "/ask":
                return self._handle_ask(body)
            if parsed.path == "/summarize/page":
                return self._handle_summarize(body)
            if parsed.path == "/archive/create":
                return self._handle_archive(body)
            self._write_json(404, {"error": "Not found"})
        except FileNotFoundError as exc:
            self._write_json(404, {"error": str(exc)})
        except ValueError as exc:
            self._write_json(400, {"error": str(exc)})
        except json.JSONDecodeError as exc:
            self._write_json(400, {"error": f"invalid json: {exc.msg}"})
        except Exception as exc:  # pragma: no cover
            self._write_json(500, {"error": str(exc)})

    def log_message(self, format: str, *args) -> None:
        return

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _write_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(raw)

    def _serve_static(self, name: str) -> None:
        web_root = Path(self.server.web_root)  # type: ignore[attr-defined]
        path = (web_root / name).resolve()
        if web_root not in path.parents and path != web_root / name:
            self._write_json(404, {"error": "Not found"})
            return
        if not path.exists():
            self._write_json(404, {"error": "Not found"})
            return
        content = path.read_bytes()
        content_type = guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    @property
    def data_dir(self) -> Path:
        return Path(self.server.data_dir)  # type: ignore[attr-defined]

    def _handle_inject(self, body: dict) -> None:
        doc, content, instruction, input_payload, page = _build_document_from_payload(body)
        openclaw = _resolve_openclaw_runtime_config(self.data_dir, body.get("openclaw"))
        output_dir = self.data_dir / "indices" / doc.doc_id
        index = LongDocIndex(doc, build_chunks(doc))
        index.save(str(output_dir))
        record = save_input_record(
            str(output_dir),
            source=str(body.get("source") or "browser_sidebar"),
            document=doc,
            instruction=instruction,
            content=content,
            metadata={
                "selectedText": page.get("selectedText") or input_payload.get("metadata", {}).get("selectedText", ""),
                "headings": page.get("headings") or input_payload.get("metadata", {}).get("headings", []),
                "paragraphCount": len([part for part in content.split("\n\n") if part.strip()]),
                "capturedAt": page.get("capturedAt") or input_payload.get("metadata", {}).get("capturedAt", ""),
                "language": doc.language,
            },
        )
        payload = {
            "inputId": record.input_id,
            "stored": True,
            "contentStats": {
                "length": len(content),
                "extractionMode": page.get("extractionMode") or body.get("extractionMode") or "main-content",
                "paragraphCount": record.metadata["paragraphCount"],
            },
            "output": build_injected_output(doc, content, instruction=instruction),
            "indexRef": {"docId": doc.doc_id, "path": str(output_dir)},
        }
        session_id = body.get("sessionId")
        if openclaw["baseUrl"]:
            sidebar_text = _build_sidebar_text(
                title=doc.title,
                url=doc.source,
                selected_text=str(record.metadata.get("selectedText") or ""),
                content=content,
            )
            session_key = _gateway_session_key(str(session_id or record.input_id), openclaw["agent"])
            try:
                remote_exchange = _send_gateway_message_and_wait(
                    openclaw=openclaw,
                    session_key=session_key,
                    message=_build_inject_message(
                        openclaw=openclaw,
                        sidebar_text=sidebar_text,
                        instruction=instruction,
                    ),
                    idempotency_key=f"inject-{record.input_id}",
                )
                remote_message = remote_exchange.get("message") or {}
                payload["openclaw"] = {
                    "mode": "gateway-rpc",
                    "model": openclaw["model"],
                    "agent": openclaw["agent"],
                    "sessionKey": session_key,
                    "responseText": _extract_gateway_message_text(remote_message) if remote_message else "NO_REPLY",
                    "response": remote_exchange,
                }
            except ValueError as exc:
                if not openclaw["fallbackToLocal"]:
                    raise
                payload["openclaw"] = {
                    "mode": "fallback",
                    "model": openclaw["model"],
                    "agent": openclaw["agent"],
                    "error": str(exc),
                }
        if session_id:
            session = _load_session(self.data_dir, str(session_id))
            session["openclaw"] = {
                "model": openclaw["model"],
                "agent": openclaw["agent"],
                "fallbackToLocal": openclaw["fallbackToLocal"],
                "configRef": "default",
            }
            session["openclawSessionKey"] = _gateway_session_key(session["id"], openclaw["agent"])
            session["activeIndexRef"] = payload["indexRef"]
            session["activeDocument"] = {
                "title": doc.title,
                "url": doc.source,
                "content": content,
                "instruction": instruction,
                "selectedText": str(record.metadata.get("selectedText") or ""),
            }
            session["documentSummary"] = payload["output"]["summary"]
            session["documentStats"] = payload["contentStats"]
            _append_turn(
                session,
                role="system",
                text=f"已注入文档：{doc.title}",
                extra={"inputId": record.input_id, "indexRef": payload["indexRef"]},
            )
            _save_session(self.data_dir, session)
            payload["sessionId"] = session["id"]
        self._write_json(200, payload)

    def _resolve_index_dir(self, body: dict) -> Path:
        index_ref = body.get("indexRef", {})
        if "path" in index_ref:
            return Path(index_ref["path"])
        if "docId" in index_ref:
            return self.data_dir / "indices" / str(index_ref["docId"])
        doc_id = body.get("docId")
        if doc_id:
            return self.data_dir / "indices" / str(doc_id)
        session_id = body.get("sessionId")
        if session_id:
            session = _load_session(self.data_dir, str(session_id))
            active = session.get("activeIndexRef")
            if active:
                return self._resolve_index_dir({"indexRef": active})
        raise ValueError("indexRef.path or indexRef.docId is required")

    def _handle_create_session(self) -> None:
        session = _create_session(self.data_dir)
        self._write_json(200, {"sessionId": session["id"], "session": session})

    def _handle_save_openclaw_settings(self, body: dict) -> None:
        existing = _load_openclaw_settings(self.data_dir)
        normalized = _normalize_openclaw_config(body)
        if not normalized["bearerToken"] and existing.get("bearerToken"):
            normalized["bearerToken"] = existing["bearerToken"]
        stored = _save_openclaw_settings(self.data_dir, normalized)
        self._write_json(200, {"saved": True, "settings": _public_openclaw_settings(stored)})

    def _handle_openclaw_validate(self, body: dict) -> None:
        self._write_json(200, _validate_openclaw_config(body))

    def _handle_ask(self, body: dict) -> None:
        question = str(body.get("question") or "").strip()
        if not question:
            raise ValueError("question is required")
        session_id = body.get("sessionId")
        session = _load_session(self.data_dir, str(session_id)) if session_id else None
        openclaw = _resolve_openclaw_runtime_config(self.data_dir, body.get("openclaw") or (session or {}).get("openclaw"))
        response: dict
        if openclaw["baseUrl"]:
            session_key = (
                str((session or {}).get("openclawSessionKey") or "")
                or _gateway_session_key(str(session_id or "browser-sidebar"), openclaw["agent"])
            )
            try:
                remote_exchange = _send_gateway_message_and_wait(
                    openclaw=openclaw,
                    session_key=session_key,
                    message=_build_question_message(question),
                    idempotency_key=f"ask-{secrets.token_hex(8)}",
                )
                remote_message = remote_exchange.get("message") or {}
                answer_text = _extract_gateway_message_text(remote_message) if remote_message else ""
                if not answer_text:
                    answer_text = "OpenClaw 已接收问题，但在轮询窗口内未返回最终 assistant 消息。"
                response = {
                    "question": question,
                    "answerText": answer_text,
                    "openclaw": {
                        "mode": "gateway-rpc",
                        "model": openclaw["model"],
                        "agent": openclaw["agent"],
                        "sessionKey": session_key,
                        "response": remote_exchange,
                    },
                }
            except ValueError as exc:
                if not openclaw["fallbackToLocal"]:
                    raise
                index = load_index(str(self._resolve_index_dir(body)))
                limit = int(body.get("limit") or 5)
                response = answer_question_json(index, question, limit=limit)
                response["openclaw"] = {
                    "mode": "fallback",
                    "model": openclaw["model"],
                    "agent": openclaw["agent"],
                    "error": str(exc),
                }
        else:
            index = load_index(str(self._resolve_index_dir(body)))
            limit = int(body.get("limit") or 5)
            response = answer_question_json(index, question, limit=limit)
        if session_id:
            assert session is not None
            session["openclaw"] = {
                "model": openclaw["model"],
                "agent": openclaw["agent"],
                "fallbackToLocal": openclaw["fallbackToLocal"],
                "configRef": "default",
            }
            session["openclawSessionKey"] = _gateway_session_key(session["id"], openclaw["agent"])
            _append_turn(session, role="user", text=question)
            _append_turn(
                session,
                role="assistant",
                text=json.dumps(response, ensure_ascii=False, indent=2),
                extra={"question": question, "evidence": response.get("evidence", [])},
            )
            _save_session(self.data_dir, session)
            response["sessionId"] = session["id"]
        self._write_json(200, response)

    def _handle_summarize(self, body: dict) -> None:
        if "indexRef" in body or "docId" in body:
            index = load_index(str(self._resolve_index_dir(body)))
        elif "input" in body or "page" in body or "content" in body:
            doc, _, _, _, _ = _build_document_from_payload(body)
            index = LongDocIndex(doc, build_chunks(doc))
        elif "path" in body:
            doc = ingest_document(str(body["path"]), source=body.get("source"))
            index = LongDocIndex(doc, build_chunks(doc))
        else:
            raise ValueError("summarize requires indexRef, path, or input/page content")
        self._write_json(200, {"summaryText": summarize_document(index)})

    def _handle_archive(self, body: dict) -> None:
        archives = _load_json_list(_archive_path(self.data_dir))
        source = body.get("source", {})
        summary = body.get("summary", {})
        item = {
            "id": f"arc_{int(datetime.now(UTC).timestamp() * 1000)}",
            "title": summary.get("title") or source.get("title") or "Untitled",
            "url": summary.get("url") or source.get("url") or "",
            "summary": summary.get("summary") or "",
            "keyPoints": summary.get("keyPoints") or [],
            "tags": body.get("tags") or summary.get("tags") or [],
            "sourceCapturedAt": source.get("capturedAt") or None,
            "inputId": body.get("inputId") or body.get("injectedInputId") or None,
            "createdAt": datetime.now(UTC).isoformat(),
        }
        archives.insert(0, item)
        _save_json_list(_archive_path(self.data_dir), archives)
        self._write_json(200, {"archiveId": item["id"], "item": item, "total": len(archives)})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local HTTP gateway for longdoc/OpenClaw-style flows")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8787, help="Port to bind")
    parser.add_argument("--data-dir", default=".gateway_data", help="Directory for indices and archives")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    server = ThreadingHTTPServer((args.host, args.port), GatewayHandler)
    server.data_dir = str(Path(args.data_dir).resolve())  # type: ignore[attr-defined]
    server.web_root = str((Path(__file__).resolve().parents[2] / "web").resolve())  # type: ignore[attr-defined]
    print(f"LongDoc gateway running on http://{args.host}:{args.port} with data dir {server.data_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
