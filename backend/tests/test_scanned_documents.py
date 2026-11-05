import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.config import get_ocr_model, ocr_max_pages
from app.core.errors import ConfigurationError
from app.processing.page_images import PageImage
from app.processing.pdf_extraction import ExtractedPage, NoTextError, PDFExtractionError
from app.tasks import documents as jobs

SCAN = [PageImage(1, b"page")]
READ = [ExtractedPage(1, "Read from the image")]


class ExtractPagesTests(unittest.TestCase):
    def test_a_pdf_with_text_is_never_sent_to_the_vision_model(self):
        text = [ExtractedPage(1, "Typed text")]
        with (
            patch.object(jobs, "extract_pdf", return_value=text),
            patch.object(jobs, "ocr_pages") as ocr,
        ):
            self.assertEqual(jobs._extract_pages(Path("a.pdf")), text)
        ocr.assert_not_called()

    def test_a_pdf_without_text_is_drawn_and_read_as_images(self):
        with (
            patch.object(jobs, "extract_pdf", side_effect=NoTextError("none")),
            patch.object(jobs, "render_pdf_pages", return_value=SCAN) as render,
            patch.object(jobs, "ocr_pages", return_value=READ) as ocr,
        ):
            self.assertEqual(jobs._extract_pages(Path("scan.pdf")), READ)
        render.assert_called_once_with(Path("scan.pdf"), ocr_max_pages())
        ocr.assert_called_once_with(SCAN)

    def test_a_picture_goes_straight_to_the_vision_model(self):
        for name in ("a.png", "b.JPG", "c.jpeg"):
            with self.subTest(name=name):
                with (
                    patch.object(jobs, "extract_pdf") as extract,
                    patch.object(jobs, "load_image", return_value=SCAN[0]) as load,
                    patch.object(jobs, "ocr_pages", return_value=READ) as ocr,
                ):
                    self.assertEqual(jobs._extract_pages(Path(name)), READ)
                extract.assert_not_called()
                load.assert_called_once_with(Path(name))
                ocr.assert_called_once_with(SCAN)

    def test_other_pdf_problems_are_not_retried_as_images(self):
        with (
            patch.object(jobs, "extract_pdf", side_effect=PDFExtractionError("Encrypted")),
            patch.object(jobs, "ocr_pages") as ocr,
        ):
            with self.assertRaisesRegex(PDFExtractionError, "Encrypted"):
                jobs._extract_pages(Path("locked.pdf"))
        ocr.assert_not_called()


class OcrSettingsTests(unittest.TestCase):
    def test_defaults(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OCR_MODEL", None)
            os.environ.pop("OCR_MAX_PAGES", None)
            self.assertEqual(ocr_max_pages(), 10)
            self.assertEqual(get_ocr_model(), "gpt-4.1-mini")

    def test_the_model_and_page_limit_can_be_changed(self):
        with patch.dict(os.environ, {"OCR_MODEL": "gpt-test", "OCR_MAX_PAGES": "3"}):
            self.assertEqual(get_ocr_model(), "gpt-test")
            self.assertEqual(ocr_max_pages(), 3)

    def test_a_page_limit_below_one_is_refused(self):
        with patch.dict(os.environ, {"OCR_MAX_PAGES": "0"}):
            with self.assertRaises(ConfigurationError):
                ocr_max_pages()
