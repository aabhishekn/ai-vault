import unittest

from app.core.pricing import estimate_cost_usd


class PricingTests(unittest.TestCase):
    def test_chat_cost_uses_separate_input_and_output_prices(self):
        self.assertEqual(estimate_cost_usd("gpt-4.1-mini", 1_000_000, 1_000_000), 2.0)

    def test_embedding_cost_has_no_output_price(self):
        self.assertEqual(estimate_cost_usd("text-embedding-3-small", 1_000_000), 0.02)

    def test_dated_snapshot_matches_its_base_model(self):
        self.assertEqual(
            estimate_cost_usd("gpt-4.1-mini-2025-04-14", 1000, 1000),
            estimate_cost_usd("gpt-4.1-mini", 1000, 1000),
        )

    def test_a_variant_of_a_priced_model_is_not_priced_as_the_base_model(self):
        self.assertIsNone(estimate_cost_usd("gpt-4.1-nano", 10, 10))
        self.assertEqual(estimate_cost_usd("gpt-4.1", 1_000_000, 1_000_000), 10.0)
        self.assertEqual(
            estimate_cost_usd("gpt-4.1-2025-04-14", 1000, 1000),
            estimate_cost_usd("gpt-4.1", 1000, 1000),
        )

    def test_similar_prefix_is_not_a_match(self):
        self.assertIsNone(estimate_cost_usd("gpt-4.1-minimal", 10, 10))

    def test_unknown_model_has_no_estimate(self):
        self.assertIsNone(estimate_cost_usd("mystery-model", 10, 10))
