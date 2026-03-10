from __future__ import annotations

import json
from pathlib import Path

from .models import Document
from .text import detect_language, normalize_text


def _is_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith("#"):
        return True
    if len(stripped) > 120:
        return False
    alpha_ratio = sum(1 for char in stripped if char.isalpha()) / max(len(stripped), 1)
    return stripped == stripped.title() or alpha_ratio < 0.65 and stripped.endswith(":")


def parse_sections(text: str) -> tuple[str, list[str], list[str]]:
    lines = [line.strip() for line in text.splitlines()]
    title = next((line.lstrip("# ").strip() for line in lines if line.strip()), "Untitled document")
    sections: list[str] = []
    section_titles: list[str] = []
    current: list[str] = []
    current_title = title

    for line in lines:
        if not line:
            if current and current[-1] != "":
                current.append("")
            continue
        if _is_heading(line) and current:
            sections.append("\n".join(current).strip())
            section_titles.append(current_title)
            current_title = line.lstrip("# ").strip() or "Untitled section"
            current = [line.lstrip("# ").strip()]
        else:
            current.append(line.lstrip("# ").strip())

    if current:
        sections.append("\n".join(current).strip())
        section_titles.append(current_title)

    filtered_sections: list[str] = []
    filtered_titles: list[str] = []
    for section, section_title in zip(sections, section_titles, strict=False):
        if section:
            filtered_sections.append(section)
            filtered_titles.append(section_title)
    return title, filtered_sections, filtered_titles


def _looks_like_capture_payload(raw: str) -> bool:
    preview = raw.lstrip()[:200]
    return preview.startswith("{") and '"output"' in raw and ("PageContent:" in raw or '"excerpt"' in raw)


def _from_capture_payload(file_path: Path, raw: str, source: str | None = None) -> Document:
    payload = json.loads(raw)
    output = payload.get("output", {})
    summary = output.get("summary", {})
    excerpt = output.get("excerpt", "")
    text = output.get("text", "")
    title = summary.get("title") or "Untitled document"
    resolved_source = source or summary.get("url") or output.get("url") or str(file_path)

    content = excerpt or text
    if "PageContent:" in content:
        content = content.split("PageContent:", 1)[1].strip()
    clean_text = normalize_text(content)
    _, sections, section_titles = parse_sections(clean_text)
    if not sections:
        sections = [clean_text]
        section_titles = [title]

    return Document(
        doc_id=file_path.stem,
        title=title,
        source=resolved_source,
        language=detect_language(clean_text),
        clean_text=clean_text,
        sections=sections,
        section_titles=section_titles,
    )


def ingest_document(path: str, source: str | None = None) -> Document:
    file_path = Path(path)
    raw = file_path.read_text(encoding="utf-8")
    if _looks_like_capture_payload(raw):
        return _from_capture_payload(file_path, raw, source=source)
    return ingest_text(raw, doc_id=file_path.stem, source=source or str(file_path))


def ingest_text(raw: str, *, doc_id: str, source: str) -> Document:
    clean_text = normalize_text(raw)
    title, sections, section_titles = parse_sections(clean_text)
    return Document(
        doc_id=doc_id,
        title=title,
        source=source,
        language=detect_language(clean_text),
        clean_text=clean_text,
        sections=sections,
        section_titles=section_titles,
    )
