"""Turn scanned PDF pages and image files into small JPEGs for the vision model."""

import io
from dataclasses import dataclass
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, UnidentifiedImageError

from app.processing.pdf_extraction import PDFExtractionError

# Longest side sent to the model: sharp enough to read small print, small enough to stay cheap.
MAX_SIDE = 2000
# An image whose decoded size would need this many pixels is refused before it is decoded.
MAX_PIXELS = 40_000_000
JPEG_QUALITY = 85


@dataclass(frozen=True)
class PageImage:
    page_number: int
    data: bytes
    mime: str = "image/jpeg"


def _encode(image: Image.Image) -> bytes:
    if image.mode in ("RGBA", "LA", "P"):
        # Transparent areas would turn black and hide dark text, so flatten onto white.
        rgba = image.convert("RGBA")
        flat = Image.new("RGB", rgba.size, "white")
        flat.paste(rgba, mask=rgba.getchannel("A"))
        image = flat
    else:
        image = image.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    output = io.BytesIO()
    image.save(output, "JPEG", quality=JPEG_QUALITY)
    return output.getvalue()


def load_image(path: Path) -> PageImage:
    """An uploaded picture is read as a single page."""
    try:
        with Image.open(path) as image:
            if image.width * image.height > MAX_PIXELS:
                raise PDFExtractionError("This image is too large to read.")
            return PageImage(1, _encode(image))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise PDFExtractionError("Unable to read this image. It may be damaged.") from error


def render_pdf_pages(path: Path, max_pages: int) -> list[PageImage]:
    """Draw every page of a PDF that has no text layer, refusing more than `max_pages`."""
    try:
        pdf = pdfium.PdfDocument(path)
    except pdfium.PdfiumError as error:
        raise PDFExtractionError(
            "Unable to read this PDF. It may be damaged or invalid."
        ) from error
    try:
        if len(pdf) > max_pages:
            raise PDFExtractionError(
                f"This scanned PDF has {len(pdf)} pages. Reading scans supports up to "
                f"{max_pages} pages."
            )
        images = []
        for number in range(len(pdf)):
            page = pdf[number]
            width, height = page.get_size()
            scale = min(4.0, MAX_SIDE / max(width, height))
            images.append(PageImage(number + 1, _encode(page.render(scale=scale).to_pil())))
        return images
    finally:
        pdf.close()
