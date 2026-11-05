import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class PDFExtractionError(ValueError):
    """The PDF cannot provide usable text for document processing."""


class NoTextError(PDFExtractionError):
    """The file has no text layer; its pages may still be readable as images."""


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    text: str


# Some PDFs write an accented letter as the accent first, then the plain letter ("B¨orm" for
# "Börm"). Searching and the model both read that badly, so the pair is joined.
_ACCENTS = {"\u00a8": "\u0308", "\u00b4": "\u0301", "\u02c6": "\u0302", "\u02dc": "\u0303"}
_ACCENT_BEFORE_LETTER = re.compile("([" + "".join(_ACCENTS) + "])([A-Za-z])")


def clean_text(text: str) -> str:
    """Text as people read it: accents joined to their letters, ligatures (ﬁ, ﬂ, ﬀ) spelled
    out, and the NUL characters PostgreSQL cannot store removed."""
    text = _ACCENT_BEFORE_LETTER.sub(lambda m: m.group(2) + _ACCENTS[m.group(1)], text)
    return unicodedata.normalize("NFKC", text).replace("\x00", "")


def extract_pdf(path: Path) -> list[ExtractedPage]:
    """Read text locally, preserving original one-based page numbers."""
    try:
        with path.open("rb") as source:
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise PDFExtractionError("Encrypted PDFs are not supported yet.")
            pages = [
                ExtractedPage(
                    page_number=number, text=clean_text(page.extract_text() or "").strip()
                )
                for (number, page) in enumerate(reader.pages, start=1)
            ]
    except PdfReadError as error:
        raise PDFExtractionError(
            "Unable to read this PDF. It may be damaged or invalid."
        ) from error
    if not any((page.text for page in pages)):
        raise NoTextError("No readable text found in this PDF.")
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
