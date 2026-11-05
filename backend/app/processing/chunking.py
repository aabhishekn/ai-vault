from collections.abc import Iterable
from dataclasses import dataclass

from llama_index.core.node_parser import SentenceSplitter

from app.processing.pdf_extraction import ExtractedPage, clean_text


@dataclass(frozen=True)
class TextChunk:
    chunk_index: int
    page_number: int
    text: str


def _count_words(text: str) -> list[str]:
    # Chunk sizes are counted in words, so no tokenizer model has to be downloaded.
    return text.split()


def chunk_pages(
    pages: Iterable[ExtractedPage], *, max_words: int = 200, overlap_words: int = 40
) -> list[TextChunk]:
    """Split each page with LlamaIndex's sentence-aware splitter, never crossing a page.

    Pages are split one at a time so every chunk keeps the page it came from, which is
    what makes page-exact citations possible. Chunks end on sentence boundaries where
    they can and stay within ``max_words`` words, overlapping by about ``overlap_words``.
    """
    if max_words <= 0:
        raise ValueError("max_words must be positive")
    if not 0 <= overlap_words < max_words:
        raise ValueError("overlap_words must be between 0 and max_words - 1")
    splitter = SentenceSplitter(
        chunk_size=max_words,
        chunk_overlap=overlap_words,
        tokenizer=_count_words,
        include_metadata=False,
    )
    chunks = []
    for page in pages:
        # Line breaks stay: they separate a heading from the lines under it, which tells
        # the model which company or section a bullet belongs to.
        for text in splitter.split_text(clean_text(page.text)):
            text = "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())
            if text:
                chunks.append(
                    TextChunk(chunk_index=len(chunks), page_number=page.page_number, text=text)
                )
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
