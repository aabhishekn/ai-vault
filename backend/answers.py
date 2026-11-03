from uuid import UUID

from fastapi import APIRouter, HTTPException
from openai import APIError

from answer_generation import generate_answer
from schemas import AnswerResponse, SearchRequest
from search import search_document

router = APIRouter(prefix="/documents", tags=["answers"])


@router.post("/{document_id}/ask", response_model=AnswerResponse)
def ask_document(document_id: UUID, request: SearchRequest) -> AnswerResponse:
    retrieval = search_document(document_id, request)
    try:
        return generate_answer(retrieval)
    except (APIError, RuntimeError):
        raise HTTPException(503, "Answer generation service unavailable") from None
    except ValueError:
        raise HTTPException(502, "Answer generation returned an incomplete or invalid answer") from None
