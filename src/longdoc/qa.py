from __future__ import annotations

from .chunking import build_chunks
from .indexing import LongDocIndex
from .models import Document


def summarize_document(index: LongDocIndex, max_sections: int = 8) -> str:
    section_map: dict[str, list[str]] = {}
    for chunk in index.chunks:
        section_map.setdefault(chunk.section_title, []).append(chunk.text.replace("\n", " "))

    lines = [
        f"文档: {index.document.title}",
        f"来源: {index.document.source}",
        "",
        "摘要:",
    ]
    for section_title, texts in list(section_map.items())[:max_sections]:
        joined = " ".join(texts)
        snippet = joined[:260].strip()
        lines.append(f"- [{section_title}] {snippet}")
    return "\n".join(lines)


def summarize_for_injection(document: Document) -> dict:
    chunks = build_chunks(document, target_chars=1200, overlap_paragraphs=1)
    index = LongDocIndex(document, chunks)
    key_points: list[str] = []
    for title in document.section_titles[:5]:
        if title and title not in key_points:
            key_points.append(title)
    if not key_points:
        for chunk in chunks[:5]:
            key_points.extend(chunk.keywords)
            if len(key_points) >= 5:
                break

    summary_parts: list[str] = []
    for chunk in chunks[:2]:
        summary_parts.append(chunk.text.replace("\n", " ")[:240].strip())
    summary = " ".join(part for part in summary_parts if part).strip() or "未提取到有效正文。"

    return {
        "title": document.title,
        "url": document.source,
        "summary": summary,
        "keyPoints": key_points[:5],
        "tags": ["WebClip"],
        "wordCount": len(document.clean_text),
    }


def build_injected_output(document: Document, content: str, instruction: str = "") -> dict:
    summary = summarize_for_injection(document)
    lines = [
        "已接收网页内容",
        f"标题: {document.title}",
        f"采集长度: {len(content)} 字符",
    ]
    if document.source:
        lines.append(f"URL: {document.source}")
    if instruction:
        lines.append(f"附加指令: {instruction}")
    lines.append(f"摘要: {summary['summary']}")
    if summary["keyPoints"]:
        lines.append(f"关键点: {' | '.join(summary['keyPoints'])}")
    lines.append(f"正文预览:\n{content[:1200]}")
    return {
        "role": "assistant",
        "text": "\n".join(lines),
        "summary": summary,
        "excerpt": content[:4000],
    }


def answer_question_json(index: LongDocIndex, question: str, limit: int = 5) -> dict:
    results = index.search(question, limit=limit)
    return {
        "document": {
            "title": index.document.title,
            "source": index.document.source,
        },
        "question": question,
        "evidence": [
            {
                "chunkId": result.chunk.chunk_id,
                "sectionTitle": result.chunk.section_title,
                "score": round(result.score, 4),
                "paragraphRange": [result.chunk.start_paragraph, result.chunk.end_paragraph],
                "snippet": result.chunk.text[:280],
                "keywords": result.chunk.keywords,
            }
            for result in results
        ],
    }


def answer_question(index: LongDocIndex, question: str, limit: int = 5) -> str:
    results = index.search(question, limit=limit)
    if not results:
        return "未检索到相关证据。建议缩小问题范围，或先检查文档是否完成切块和入库。"

    lines = [
        f"文档: {index.document.title}",
        f"问题: {question}",
        "",
        "结论:",
    ]

    for result in results[:3]:
        snippet = result.chunk.text.replace("\n", " ")
        snippet = snippet[:220].strip()
        lines.append(
            f"- [{result.chunk.section_title}] {snippet} "
            f"(paragraph {result.chunk.start_paragraph}-{result.chunk.end_paragraph}, score={result.score:.2f})"
        )

    lines.extend(["", "引用:"])
    for result in results:
        lines.append(
            f"- {result.chunk.chunk_id} | {result.chunk.section_title} | "
            f"paragraph {result.chunk.start_paragraph}-{result.chunk.end_paragraph}"
        )

    return "\n".join(lines)
