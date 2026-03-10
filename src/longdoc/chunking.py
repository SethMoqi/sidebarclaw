from __future__ import annotations

from .models import Chunk, Document
from .text import extract_keywords


def _section_title(section: str) -> str:
    first_line = section.splitlines()[0].strip()
    return first_line[:100] or "Untitled section"


def _split_paragraphs(section: str) -> list[str]:
    paragraphs = [part.strip() for part in section.split("\n\n")]
    return [paragraph for paragraph in paragraphs if paragraph]


def build_chunks(document: Document, target_chars: int = 1200, overlap_paragraphs: int = 1) -> list[Chunk]:
    chunks: list[Chunk] = []
    chunk_count = 0
    paragraph_cursor = 0

    for index, section in enumerate(document.sections):
        if index < len(document.section_titles):
            section_title = document.section_titles[index]
        else:
            section_title = _section_title(section)
        paragraphs = _split_paragraphs(section)
        start = 0

        while start < len(paragraphs):
            size = 0
            end = start
            current: list[str] = []

            while end < len(paragraphs) and size < target_chars:
                current.append(paragraphs[end])
                size += len(paragraphs[end])
                end += 1

            text = "\n\n".join(current)
            chunks.append(
                Chunk(
                    chunk_id=f"{document.doc_id}-chunk-{chunk_count}",
                    doc_id=document.doc_id,
                    section_title=section_title,
                    start_paragraph=paragraph_cursor + start,
                    end_paragraph=paragraph_cursor + end - 1,
                    text=text,
                    keywords=extract_keywords(text),
                )
            )
            chunk_count += 1
            if end >= len(paragraphs):
                break
            start = max(end - overlap_paragraphs, start + 1)

        paragraph_cursor += len(paragraphs)

    return chunks
