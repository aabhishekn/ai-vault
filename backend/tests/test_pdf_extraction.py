import tempfile
import unittest
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.processing.pdf_extraction import PDFExtractionError, extract_pdf


class PDFExtractionTests(unittest.TestCase):
    def write_pdf(self, path, texts, password=None):
        writer = PdfWriter()
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        for text in texts:
            page = writer.add_blank_page(width=612, height=792)
            if text:
                page[NameObject("/Resources")] = DictionaryObject(
                    {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
                )
                stream = DecodedStreamObject()
                stream.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii"))
                page[NameObject("/Contents")] = writer._add_object(stream)
        if password:
            writer.encrypt(password)
        writer.write(path)

    def test_preserves_text_and_page_numbers_including_blank_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "text.pdf"
            self.write_pdf(path, ["First page", "", "Third page"])
            pages = extract_pdf(path)
        self.assertEqual(
            [(page.page_number, page.text) for page in pages],
            [(1, "First page"), (2, ""), (3, "Third page")],
        )

    def test_rejects_pdfs_without_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "blank.pdf"
            self.write_pdf(path, [""])
            with self.assertRaisesRegex(PDFExtractionError, "No readable text"):
                extract_pdf(path)

    def test_rejects_encrypted_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "encrypted.pdf"
            self.write_pdf(path, ["Private"], password="test-password")
            with self.assertRaisesRegex(PDFExtractionError, "Encrypted"):
                extract_pdf(path)

    def test_rejects_header_only_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.pdf"
            path.write_bytes(b"%PDF-1.4\n")
            with self.assertRaisesRegex(PDFExtractionError, "damaged or invalid"):
                extract_pdf(path)

    def test_missing_file_remains_a_file_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                extract_pdf(Path(directory) / "missing.pdf")
