from __future__ import annotations

from .chunking import build_chunks
from .indexing import LongDocIndex
from .models import Document


def summarize_document(index: LongDocIndex, max_sections: int = 8) -> str:
    section_map: dict[str, list[str]] = {}
    for chunk in index.chunks:
        section_map.setdefault(chunk.section_title, []).append(chunk.text.replace("\n", " "))

    lines = [
        f"Document: {index.document.title}",
        f"Source: {index.document.source}",
        "",
        "Summary:",
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
    summary = " ".join(part for part in summary_parts if part).strip() or "No usable page text was extracted."

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
        "Page content received",
        f"Title: {document.title}",
        f"Captured length: {len(content)} characters",
    ]
    if document.source:
        lines.append(f"URL: {document.source}")
    if instruction:
        lines.append(f"Instruction: {instruction}")
    lines.append(f"Summary: {summary['summary']}")
    if summary["keyPoints"]:
        lines.append(f"Key points: {' | '.join(summary['keyPoints'])}")
    lines.append(f"Excerpt:\n{content[:1200]}")
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
        return "No relevant evidence was found. Try a narrower question or make sure the document was ingested successfully."

    lines = [
        f"Document: {index.document.title}",
        f"Question: {question}",
        "",
        "Answer:",
    ]

    for result in results[:3]:
        snippet = result.chunk.text.replace("\n", " ")
        snippet = snippet[:220].strip()
        lines.append(
            f"- [{result.chunk.section_title}] {snippet} "
            f"(paragraph {result.chunk.start_paragraph}-{result.chunk.end_paragraph}, score={result.score:.2f})"
        )

    lines.extend(["", "References:"])
    for result in results:
        lines.append(
            f"- {result.chunk.chunk_id} | {result.chunk.section_title} | "
            f"paragraph {result.chunk.start_paragraph}-{result.chunk.end_paragraph}"
        )

    return "\n".join(lines)
