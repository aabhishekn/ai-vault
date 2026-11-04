from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class PDFExtractionError(ValueError):
    """The PDF cannot provide usable text for document processing."""


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    text: str


def extract_pdf(path: Path) -> list[ExtractedPage]:
    """Read text locally, preserving original one-based page numbers."""
    try:
        with path.open("rb") as source:
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise PDFExtractionError("Encrypted PDFs are not supported yet.")
            pages = [
                ExtractedPage(page_number=number, text=(page.extract_text() or "").strip())
                for (number, page) in enumerate(reader.pages, start=1)
            ]
    except PdfReadError as error:
        raise PDFExtractionError(
            "Unable to read this PDF. It may be damaged or invalid."
        ) from error
    if not any((page.text for page in pages)):
        raise PDFExtractionError(
            "No readable text found. Scanned PDFs may need OCR, which is not supported yet."
        )
    return pages


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Preview text extracted from a local PDF")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        pages = extract_pdf(args.path)
    except (PDFExtractionError, OSError) as error:
        parser.exit(1, f"Extraction failed: {error}\n")
    print(f"Pages: {len(pages)}")
    print(f"Extracted characters: {sum((len(page.text) for page in pages))}")
    for page in pages:
        print(f"\n--- Page {page.page_number} (first 300 characters) ---")
        print(page.text[:300] or "[No text on this page]")
