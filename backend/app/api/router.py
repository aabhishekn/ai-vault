from fastapi import APIRouter

from app.api.routes import (
    ai_usage,
    answers,
    conversations,
    document_stats,
    documents,
    health,
    insights,
    processing_metrics,
    reprocessing,
    search,
    suggestions,
    summaries,
)

router = APIRouter()
router.include_router(documents.router)
router.include_router(reprocessing.router)
router.include_router(search.router)
router.include_router(answers.router)
router.include_router(conversations.router)
router.include_router(summaries.router)
router.include_router(insights.router)
router.include_router(suggestions.router)
router.include_router(document_stats.router)
router.include_router(processing_metrics.router)
router.include_router(ai_usage.router)


router.include_router(health.router)
