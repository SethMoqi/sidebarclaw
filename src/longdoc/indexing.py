from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import datetime, UTC
from pathlib import Path

from .models import Chunk, Document, InputRecord, SearchResult
from .text import tokenize


class LongDocIndex:
    def __init__(self, document: Document, chunks: list[Chunk]) -> None:
        self.document = document
        self.chunks = chunks
        self.doc_freq: dict[str, int] = defaultdict(int)
        self.term_freqs: list[Counter[str]] = []
        self.avg_doc_len = 0.0
        self._build()

    def _build(self) -> None:
        total_terms = 0
        for chunk in self.chunks:
            tokens = tokenize(chunk.text)
            total_terms += len(tokens)
            freqs = Counter(tokens)
            self.term_freqs.append(freqs)
            for term in freqs:
                self.doc_freq[term] += 1
        self.avg_doc_len = total_terms / max(len(self.chunks), 1)

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        query_tokens = tokenize(query)
        scores: list[SearchResult] = []
        total_docs = len(self.chunks)
        k1 = 1.5
        b = 0.75

        for idx, chunk in enumerate(self.chunks):
            freqs = self.term_freqs[idx]
            doc_len = sum(freqs.values()) or 1
            score = 0.0
            for term in query_tokens:
                df = self.doc_freq.get(term, 0)
                if not df:
                    continue
                idf = math.log(1 + (total_docs - df + 0.5) / (df + 0.5))
                tf = freqs[term]
                score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / max(self.avg_doc_len, 1)))
            for keyword in chunk.keywords:
                if keyword in query_tokens:
                    score += 0.25
            if score > 0:
                scores.append(SearchResult(chunk=chunk, score=score))

        return sorted(scores, key=lambda item: item.score, reverse=True)[:limit]

    def save(self, output_dir: str) -> None:
        path = Path(output_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / "document.json").write_text(
            json.dumps(self.document.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (path / "chunks.json").write_text(
            json.dumps([chunk.to_dict() for chunk in self.chunks], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def load_index(output_dir: str) -> LongDocIndex:
    path = Path(output_dir)
    document = Document(**json.loads((path / "document.json").read_text(encoding="utf-8")))
    chunks = [Chunk(**item) for item in json.loads((path / "chunks.json").read_text(encoding="utf-8"))]
    return LongDocIndex(document=document, chunks=chunks)


def save_input_record(
    output_dir: str,
    *,
    source: str,
    document: Document,
    instruction: str,
    content: str,
    metadata: dict,
) -> InputRecord:
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)
    file_path = path / "inputs.json"
    records = load_input_records(output_dir)
    timestamp = datetime.now(UTC).isoformat()
    record = InputRecord(
        input_id=f"inp_{int(datetime.now(UTC).timestamp() * 1000)}",
        source=source,
        title=document.title,
        url=document.source,
        instruction=instruction,
        content=content,
        metadata=metadata,
        created_at=timestamp,
    )
    records.insert(0, record)
    file_path.write_text(
        json.dumps([item.to_dict() for item in records], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return record


def load_input_records(output_dir: str) -> list[InputRecord]:
    file_path = Path(output_dir) / "inputs.json"
    if not file_path.exists():
        return []
    return [InputRecord(**item) for item in json.loads(file_path.read_text(encoding="utf-8"))]
