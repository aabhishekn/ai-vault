from collections.abc import Iterable
from dataclasses import dataclass

from app.processing.pdf_extraction import ExtractedPage


@dataclass(frozen=True)
class TextChunk:
    chunk_index: int
    page_number: int
    text: str


def chunk_pages(
    pages: Iterable[ExtractedPage], *, max_words: int = 200, overlap_words: int = 40
) -> list[TextChunk]:
    """Split each page into overlapping word windows without crossing page boundaries."""
    if max_words <= 0:
        raise ValueError("max_words must be positive")
    if not 0 <= overlap_words < max_words:
        raise ValueError("overlap_words must be between 0 and max_words - 1")
    chunks = []
    step = max_words - overlap_words
    for page in pages:
        words = page.text.split()
        for start in range(0, len(words), step):
            end = start + max_words
            chunks.append(
                TextChunk(
                    chunk_index=len(chunks),
                    page_number=page.page_number,
                    text=" ".join(words[start:end]),
                )
            )
            if end >= len(words):
                break
    return chunks


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    from app.processing.pdf_extraction import PDFExtractionError, extract_pdf

    parser = argparse.ArgumentParser(description="Preview page-aware chunks from a PDF")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        chunks = chunk_pages(extract_pdf(args.path))
    except (PDFExtractionError, OSError) as error:
        parser.exit(1, f"Chunking failed: {error}\n")
    print(f"Chunks: {len(chunks)}")
    for chunk in chunks:
        print(
            f"\n--- Chunk {chunk.chunk_index}, page {chunk.page_number}, {len(chunk.text.split())} words ---"
        )
        print(chunk.text[:200])
