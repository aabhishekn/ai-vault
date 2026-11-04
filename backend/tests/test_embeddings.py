import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.ai.embeddings import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, generate_embeddings


class EmbeddingTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict("os.environ", {"OPENAI_API_KEY": "test-only-placeholder"})
        self.env.start()
        self.dotenv = patch("app.core.config.load_dotenv")
        self.dotenv.start()
        self.sdk = patch("app.ai.embeddings.create_client")
        self.constructor = self.sdk.start()
        self.client = self.constructor.return_value.__enter__.return_value
        self.addCleanup(self.env.stop)
        self.addCleanup(self.dotenv.stop)
        self.addCleanup(self.sdk.stop)

    def response(self, items):
        return SimpleNamespace(
            data=items, model=EMBEDDING_MODEL, usage=SimpleNamespace(prompt_tokens=8)
        )

    def item(self, index, value=0.1, dimensions=EMBEDDING_DIMENSIONS):
        return SimpleNamespace(index=index, embedding=[value] * dimensions)

    def test_batches_text_and_returns_vectors_in_input_order_with_usage(self):
        self.client.embeddings.create.return_value = self.response(
            [self.item(1, 0.2), self.item(0, 0.1)]
        )
        result = generate_embeddings(["Leave policy", "Travel rules"])
        self.assertEqual(
            result.vectors, [[0.1] * EMBEDDING_DIMENSIONS, [0.2] * EMBEDDING_DIMENSIONS]
        )
        self.assertEqual(result.input_tokens, 8)
        self.assertEqual(result.model, EMBEDDING_MODEL)
        self.client.embeddings.create.assert_called_once_with(
            model=EMBEDDING_MODEL,
            input=["Leave policy", "Travel rules"],
            dimensions=EMBEDDING_DIMENSIONS,
            encoding_format="float",
        )

    def test_empty_batch_makes_no_request(self):
        self.assertEqual(generate_embeddings([]).vectors, [])
        self.constructor.assert_not_called()

    def test_invalid_inputs_make_no_request(self):
        for texts in [[" "], ["Valid", ""], ["text"] * 65]:
            with self.subTest(texts_count=len(texts)):
                with self.assertRaises(ValueError):
                    generate_embeddings(texts)
        self.constructor.assert_not_called()

    def test_missing_key_fails_before_creating_client(self):
        self.sdk.stop()
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
            with patch("app.ai.client.OpenAI") as provider:
                with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
                    generate_embeddings(["Hello"])
                provider.assert_not_called()

    def test_invalid_provider_response_is_rejected(self):
        for items in [
            [],
            [self.item(1)],
            [self.item(0, dimensions=3)],
            [self.item(0, value=float("nan"))],
        ]:
            with self.subTest(items_count=len(items)):
                self.client.embeddings.create.return_value = self.response(items)
                with self.assertRaises(ValueError):
                    generate_embeddings(["Hello"])

    def test_provider_failure_propagates_to_caller(self):
        self.client.embeddings.create.side_effect = TimeoutError("Provider timed out")
        with self.assertRaises(TimeoutError):
            generate_embeddings(["Hello"])

    def test_zero_vector_and_mismatched_model_are_rejected(self):
        self.client.embeddings.create.return_value = self.response([self.item(0, value=0.0)])
        with self.assertRaises(ValueError):
            generate_embeddings(["Hello"])
        response = self.response([self.item(0)])
        response.model = "different-model"
        self.client.embeddings.create.return_value = response
        with self.assertRaises(ValueError):
            generate_embeddings(["Hello"])
