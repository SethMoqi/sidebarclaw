from __future__ import annotations

import argparse
import json
from pathlib import Path

from .chunking import build_chunks
from .indexing import LongDocIndex, load_index, save_input_record
from .ingest import ingest_document
from .qa import answer_question, answer_question_json, build_injected_output, summarize_document


def _cmd_ingest(args: argparse.Namespace) -> int:
    document = ingest_document(args.input, source=args.source)
    chunks = build_chunks(document, target_chars=args.target_chars, overlap_paragraphs=args.overlap)
    index = LongDocIndex(document, chunks)
    index.save(args.output)
    print(f"Indexed '{document.title}' into {len(chunks)} chunks at {Path(args.output)}")
    return 0


def _cmd_ask(args: argparse.Namespace) -> int:
    index = load_index(args.index)
    if args.json:
        print(json.dumps(answer_question_json(index, args.question, limit=args.limit), ensure_ascii=False, indent=2))
    else:
        print(answer_question(index, args.question, limit=args.limit))
    return 0


def _cmd_summarize(args: argparse.Namespace) -> int:
    index = load_index(args.index)
    print(summarize_document(index, max_sections=args.max_sections))
    return 0


def _cmd_inject(args: argparse.Namespace) -> int:
    document = ingest_document(args.input, source=args.source)
    chunks = build_chunks(document, target_chars=args.target_chars, overlap_paragraphs=args.overlap)
    index = LongDocIndex(document, chunks)
    index.save(args.output)
    payload = build_injected_output(document, document.clean_text, instruction=args.instruction)
    record = save_input_record(
        args.output,
        source=args.origin,
        document=document,
        instruction=args.instruction,
        content=document.clean_text,
        metadata={
            "paragraphCount": sum(len(section.split("\n\n")) for section in document.sections),
            "sectionTitles": document.section_titles,
            "language": document.language,
        },
    )
    response = {
        "inputId": record.input_id,
        "stored": True,
        "contentStats": {
            "length": len(document.clean_text),
            "extractionMode": args.extraction_mode,
            "paragraphCount": record.metadata["paragraphCount"],
        },
        "output": payload,
    }
    print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Long-document MVP pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest", help="Ingest a local text or html document")
    ingest_parser.add_argument("input", help="Path to input .txt, .md, or .html file")
    ingest_parser.add_argument("--output", default=".longdoc_index", help="Directory to store index files")
    ingest_parser.add_argument("--source", default=None, help="Optional source label or URL")
    ingest_parser.add_argument("--target-chars", type=int, default=1200, help="Chunk size target in characters")
    ingest_parser.add_argument("--overlap", type=int, default=1, help="Paragraph overlap between chunks")
    ingest_parser.set_defaults(func=_cmd_ingest)

    ask_parser = subparsers.add_parser("ask", help="Query an indexed document")
    ask_parser.add_argument("question", help="Question to ask against the index")
    ask_parser.add_argument("--index", default=".longdoc_index", help="Directory containing index files")
    ask_parser.add_argument("--limit", type=int, default=5, help="Number of chunks to retrieve")
    ask_parser.add_argument("--json", action="store_true", help="Return structured evidence JSON")
    ask_parser.set_defaults(func=_cmd_ask)

    summarize_parser = subparsers.add_parser("summarize", help="Summarize an indexed document by section")
    summarize_parser.add_argument("--index", default=".longdoc_index", help="Directory containing index files")
    summarize_parser.add_argument("--max-sections", type=int, default=8, help="Maximum sections to summarize")
    summarize_parser.set_defaults(func=_cmd_summarize)

    inject_parser = subparsers.add_parser("inject", help="Store a document as an OpenClaw-style injected input")
    inject_parser.add_argument("input", help="Path to input .txt, .md, .html, or capture JSON file")
    inject_parser.add_argument("--output", default=".longdoc_index", help="Directory to store index and input files")
    inject_parser.add_argument("--source", default=None, help="Optional source label or URL")
    inject_parser.add_argument("--instruction", default="", help="Optional instruction attached to the injected input")
    inject_parser.add_argument("--origin", default="browser_sidebar", help="Input source name")
    inject_parser.add_argument("--extraction-mode", default="main-content", help="Extraction mode label")
    inject_parser.add_argument("--target-chars", type=int, default=1200, help="Chunk size target in characters")
    inject_parser.add_argument("--overlap", type=int, default=1, help="Paragraph overlap between chunks")
    inject_parser.set_defaults(func=_cmd_inject)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
