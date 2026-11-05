import base64
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.ai import ocr
from app.processing.page_images import PageImage
from app.processing.pdf_extraction import NoTextError, PDFExtractionError


class FakeClient:
    """Answers each image with the text registered for its bytes; remembers every request."""

    def __init__(self, texts):
        self.texts = texts
        self.requests = []
        self.responses = SimpleNamespace(create=self.create)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def create(self, **kwargs):
        self.requests.append(kwargs)
        url = kwargs["input"][0]["content"][0]["image_url"]
        data = base64.b64decode(url.split(",", 1)[1])
        text = self.texts[data]
        if isinstance(text, Exception):
            raise text
        return SimpleNamespace(
            output_text=text,
            model="gpt-test",
            usage=SimpleNamespace(input_tokens=100, output_tokens=20),
        )


def pages(*names):
    return [PageImage(number, name) for number, name in enumerate(names, start=1)]


class OcrTests(unittest.TestCase):
    def run_ocr(self, texts, images):
        client = FakeClient(texts)
        with patch.object(ocr, "create_client", return_value=client):
            return ocr.ocr_pages(images), client

    def test_text_comes_back_in_page_order_with_page_numbers(self):
        result, _ = self.run_ocr(
            {b"a": " First page ", b"b": "Second", b"c": "Third"}, pages(b"a", b"b", b"c")
        )
        self.assertEqual(
            [(page.page_number, page.text) for page in result],
            [(1, "First page"), (2, "Second"), (3, "Third")],
        )

    def test_a_page_without_text_stays_in_place_as_an_empty_page(self):
        result, _ = self.run_ocr({b"a": "Text", b"b": ocr.NO_TEXT}, pages(b"a", b"b"))
        self.assertEqual([(page.page_number, page.text) for page in result], [(1, "Text"), (2, "")])

    def test_nothing_legible_anywhere_is_a_clear_failure(self):
        with self.assertRaisesRegex(NoTextError, "even when the pages were read as images"):
            self.run_ocr({b"a": ocr.NO_TEXT, b"b": ""}, pages(b"a", b"b"))

    def test_it_is_a_document_error_a_person_can_be_told_about(self):
        self.assertTrue(issubclass(NoTextError, PDFExtractionError))

    def test_the_image_is_sent_inline_and_not_stored_by_the_provider(self):
        _, client = self.run_ocr({b"a": "Text"}, pages(b"a"))
        (request,) = client.requests
        image = request["input"][0]["content"][0]
        self.assertTrue(image["image_url"].startswith("data:image/jpeg;base64,"))
        self.assertIs(request["store"], False)
        self.assertIn("untrusted", request["instructions"])

    def test_each_page_is_logged_as_an_ocr_call_with_its_tokens(self):
        with self.assertLogs("app.ai", level="INFO") as logs:
            self.run_ocr({b"a": "Text"}, pages(b"a"))
        record = logs.records[0]
        self.assertEqual(
            (record.operation, record.model, record.input_tokens, record.output_tokens),
            ("ocr", "gpt-test", 100, 20),
        )

    def test_a_provider_failure_is_not_reported_as_a_property_of_the_document(self):
        failure = RuntimeError("provider down")
        with self.assertRaises(RuntimeError):
            self.run_ocr({b"a": failure}, pages(b"a"))
