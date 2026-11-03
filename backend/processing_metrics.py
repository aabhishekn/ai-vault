from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from models import ProcessingAttempt
from schemas import ProcessingMetricsResponse

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/processing", response_model=ProcessingMetricsResponse)
def processing_metrics() -> ProcessingMetricsResponse:
    query = select(
        func.count(ProcessingAttempt.id).label("total_attempts"),
        *[func.count(ProcessingAttempt.id).filter(ProcessingAttempt.status == status).label(status)
          for status in ("processing", "succeeded", "failed")],
        func.avg(ProcessingAttempt.duration_ms).label("average_duration_ms"),
        func.avg(ProcessingAttempt.duration_ms).filter(ProcessingAttempt.status == "succeeded").label("average_success_duration_ms"),
        func.avg(ProcessingAttempt.duration_ms).filter(ProcessingAttempt.status == "failed").label("average_failure_duration_ms"),
        func.max(ProcessingAttempt.duration_ms).label("max_duration_ms"),
        func.coalesce(func.sum(ProcessingAttempt.embedding_input_tokens), 0).label("observed_embedding_input_tokens"),
    )
    try:
        with Session(engine) as session:
            row = dict(session.execute(query).mappings().one())
            completed = row["succeeded"] + row["failed"]
            return ProcessingMetricsResponse(
                **row, success_rate=row["succeeded"] / completed if completed else None,
            )
    except SQLAlchemyError:
        raise HTTPException(503, "Processing metrics database unavailable") from None
