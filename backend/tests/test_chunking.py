import unittest

from app.processing.chunking import chunk_pages
from app.processing.pdf_extraction import ExtractedPage


class ChunkingTests(unittest.TestCase):
    def test_overlap_retains_boundaries_and_final_words(self):
        chunks = chunk_pages([ExtractedPage(1, "a b c d e f g h i")], max_words=5, overlap_words=2)
        self.assertEqual([chunk.text for chunk in chunks], ["a b c d e", "d e f g h", "g h i"])
        self.assertEqual([chunk.chunk_index for chunk in chunks], [0, 1, 2])

    def test_keeps_original_page_numbers_and_normalizes_whitespace(self):
        chunks = chunk_pages(
            [
                ExtractedPage(1, "First\n  page\ttext"),
                ExtractedPage(2, " \n"),
                ExtractedPage(3, "Third page"),
            ]
        )
        self.assertEqual(
            [(chunk.chunk_index, chunk.page_number, chunk.text) for chunk in chunks],
            [(0, 1, "First page text"), (1, 3, "Third page")],
        )
        self.assertEqual(chunk_pages([]), [])

    def test_exact_window_has_no_redundant_tail_and_zero_overlap_is_supported(self):
        pages = [ExtractedPage(1, "a b c d")]
        self.assertEqual(len(chunk_pages(pages, max_words=4, overlap_words=2)), 1)
        self.assertEqual(
            [chunk.text for chunk in chunk_pages(pages, max_words=2, overlap_words=0)],
            ["a b", "c d"],
        )

    def test_invalid_window_settings_are_rejected(self):
        for max_words, overlap_words in [(0, 0), (-1, 0), (5, -1), (5, 5), (5, 6)]:
            with self.subTest(max_words=max_words, overlap_words=overlap_words):
                with self.assertRaises(ValueError):
                    chunk_pages([], max_words=max_words, overlap_words=overlap_words)
