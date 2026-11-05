import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from pypdf import PdfWriter

from app.processing import page_images
from app.processing.page_images import load_image, render_pdf_pages
from app.processing.pdf_extraction import PDFExtractionError


def decode(data):
    return Image.open(io.BytesIO(data))


class PictureTests(unittest.TestCase):
    def save(self, directory, name, image):
        path = Path(directory) / name
        image.save(path)
        return path

    def test_a_picture_becomes_one_small_jpeg_page(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.save(directory, "wide.png", Image.new("RGB", (4000, 1000), "white"))
            page = load_image(path)
        self.assertEqual((page.page_number, page.mime), (1, "image/jpeg"))
        image = decode(page.data)
        self.assertEqual(image.format, "JPEG")
        self.assertEqual(max(image.size), page_images.MAX_SIDE)

    def test_transparent_areas_become_white_so_dark_text_stays_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.save(directory, "clear.png", Image.new("RGBA", (20, 20), (0, 0, 0, 0)))
            page = load_image(path)
        self.assertGreater(min(decode(page.data).convert("RGB").getpixel((10, 10))), 240)

    def test_a_huge_picture_is_refused_before_it_is_decoded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.save(directory, "big.png", Image.new("RGB", (20, 20), "white"))
            with patch.object(page_images, "MAX_PIXELS", 100):
                with self.assertRaisesRegex(PDFExtractionError, "too large"):
                    load_image(path)

    def test_a_damaged_picture_is_reported_plainly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.png"
            path.write_bytes(b"\x89PNG\r\n\x1a\nnot really a picture")
            with self.assertRaisesRegex(PDFExtractionError, "Unable to read this image"):
                load_image(path)


class ScannedPdfTests(unittest.TestCase):
    def write_pdf(self, directory, pages):
        writer = PdfWriter()
        for _ in range(pages):
            writer.add_blank_page(width=612, height=792)
        path = Path(directory) / "scan.pdf"
        writer.write(path)
        return path

    def test_every_page_is_drawn_with_its_page_number(self):
        with tempfile.TemporaryDirectory() as directory:
            pages = render_pdf_pages(self.write_pdf(directory, 3), max_pages=5)
        self.assertEqual([page.page_number for page in pages], [1, 2, 3])
        for page in pages:
            self.assertEqual(decode(page.data).format, "JPEG")

    def test_more_pages_than_the_limit_are_refused_not_silently_dropped(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_pdf(directory, 3)
            with self.assertRaisesRegex(PDFExtractionError, "3 pages.*up to 2 pages"):
                render_pdf_pages(path, max_pages=2)

    def test_a_damaged_pdf_is_reported_plainly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.pdf"
            path.write_bytes(b"%PDF-1.4 this is not a pdf")
            with self.assertRaisesRegex(PDFExtractionError, "Unable to read this PDF"):
                render_pdf_pages(path, max_pages=5)
