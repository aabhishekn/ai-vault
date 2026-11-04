"""Persisted AI token usage and an estimated cost, in US dollars."""

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import EMBEDDING_MODEL
from app.core.errors import DependencyUnavailableError
from app.core.pricing import estimate_cost_usd
from app.db.database import engine
from app.db.models import ConversationTurn, ProcessingAttempt
from app.schemas.analytics import AIUsageResponse, ChatModelUsage, EmbeddingUsage

# Usage the database does not store; it is still written to the JSON logs as ai_call events.
NOT_PERSISTED = [
    "summary generation",
    "insight generation",
    "stateless POST /documents/{id}/ask answers",
    "query embeddings for search and chat",
]


def ai_usage() -> AIUsageResponse:
    model = func.coalesce(ConversationTurn.response["model"].as_string(), "unknown")
    chat_query = (
        select(
            model.label("model"),
            func.count().label("turns"),
            func.coalesce(
                func.sum(ConversationTurn.response["input_tokens"].as_integer()), 0
            ).label("input_tokens"),
            func.coalesce(
                func.sum(ConversationTurn.response["output_tokens"].as_integer()), 0
            ).label("output_tokens"),
        )
        .group_by("model")
        .order_by("model")
    )
    embedding_query = select(func.coalesce(func.sum(ProcessingAttempt.embedding_input_tokens), 0))
    try:
        with Session(engine) as session:
            chat_rows = session.execute(chat_query).mappings().all()
            embedding_tokens = int(session.scalar(embedding_query) or 0)
    except SQLAlchemyError:
        raise DependencyUnavailableError("AI usage database unavailable") from None

    chat = [
        ChatModelUsage(
            **row,
            estimated_cost_usd=estimate_cost_usd(
                row["model"], row["input_tokens"], row["output_tokens"]
            ),
        )
        for row in chat_rows
    ]
    embeddings = EmbeddingUsage(
        model=EMBEDDING_MODEL,
        input_tokens=embedding_tokens,
        estimated_cost_usd=estimate_cost_usd(EMBEDDING_MODEL, embedding_tokens),
    )
    costs = [item.estimated_cost_usd for item in (*chat, embeddings)]
    return AIUsageResponse(
        chat=chat,
        embeddings=embeddings,
        estimated_total_cost_usd=round(sum(cost for cost in costs if cost is not None), 6),
        unpriced_models=[item.model for item in chat if item.estimated_cost_usd is None],
        not_persisted=NOT_PERSISTED,
    )
