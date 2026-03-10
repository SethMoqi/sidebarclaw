from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(slots=True)
class Document:
    doc_id: str
    title: str
    source: str
    language: str
    clean_text: str
    sections: list[str]
    section_titles: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class Chunk:
    chunk_id: str
    doc_id: str
    section_title: str
    start_paragraph: int
    end_paragraph: int
    text: str
    keywords: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class SearchResult:
    chunk: Chunk
    score: float

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["chunk"] = self.chunk.to_dict()
        return payload


@dataclass(slots=True)
class InputRecord:
    input_id: str
    source: str
    title: str
    url: str
    instruction: str
    content: str
    metadata: dict
    created_at: str

    def to_dict(self) -> dict:
        return asdict(self)
