"""Approximate AI provider prices used for cost estimates.

These are estimates in US dollars per million tokens, not billing data. Verify them
against the provider's current price list before relying on the totals.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPrice:
    input_per_million: float
    output_per_million: float


PRICES_USD: dict[str, ModelPrice] = {
    "gpt-4.1": ModelPrice(2.00, 8.00),
    "gpt-4.1-mini": ModelPrice(0.40, 1.60),
    "text-embedding-3-small": ModelPrice(0.02, 0.0),
}


def price_for(model: str) -> ModelPrice | None:
    """Match an exact name or a dated snapshot such as gpt-4.1-mini-2025-04-14.

    A different variant (gpt-4.1-nano next to gpt-4.1) is not a match: it has its own price.
    """
    for name, price in PRICES_USD.items():
        if model == name or re.fullmatch(rf"{re.escape(name)}-\d{{4}}-\d{{2}}-\d{{2}}", model):
            return price
    return None


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int = 0) -> float | None:
    price = price_for(model)
    if price is None:
        return None
    cost = input_tokens * price.input_per_million + output_tokens * price.output_per_million
    return round(cost / 1_000_000, 6)
