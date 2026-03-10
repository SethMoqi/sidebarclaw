from __future__ import annotations

import html
import re
from html.parser import HTMLParser


class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def get_text(self) -> str:
        return "".join(self.parts)


def strip_html(raw: str) -> str:
    stripper = _HTMLStripper()
    stripper.feed(raw)
    return html.unescape(stripper.get_text())


def normalize_text(raw: str) -> str:
    if "<html" in raw.lower() or "</p>" in raw.lower():
        raw = strip_html(raw)
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def detect_language(text: str) -> str:
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text[:4000]))
    return "zh" if chinese_chars >= 40 else "en"


def tokenize(text: str) -> list[str]:
    ascii_tokens = re.findall(r"[A-Za-z0-9_+-]{2,}", text.lower())
    han_tokens = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    return ascii_tokens + han_tokens


def extract_keywords(text: str, limit: int = 8) -> list[str]:
    stopwords = {
        "the", "and", "for", "with", "that", "this", "from", "into", "were",
        "have", "has", "are", "was", "but", "not", "its", "their", "can",
    }
    counts: dict[str, int] = {}
    for token in tokenize(text):
        if token in stopwords or len(token) < 2:
            continue
        counts[token] = counts.get(token, 0) + 1
    return [token for token, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]
