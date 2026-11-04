from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SearchRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=3, ge=1, le=10)


class SearchMatch(BaseModel):
    chunk_id: UUID
    chunk_index: int
    page_number: int
    text: str
    cosine_distance: float


class SearchResponse(BaseModel):
    document_id: UUID
    question: str
    matches: list[SearchMatch]


class AnswerCitation(BaseModel):
    source_number: int
    chunk_id: UUID
    page_number: int
    text: str


class AnswerResponse(BaseModel):
    document_id: UUID
    question: str
    answer: str
    insufficient_evidence: bool
    citations: list[AnswerCitation]
    model: str | None
    input_tokens: int
    output_tokens: int


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_id: UUID
    created_at: datetime


class ConversationSummary(ConversationResponse):
    turn_count: int


class ConversationListResponse(BaseModel):
    items: list[ConversationSummary]
    total: int
    limit: int
    offset: int


class ConversationTurnResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    conversation_id: UUID
    turn_number: int
    response: AnswerResponse
    created_at: datetime


class ConversationHistoryResponse(ConversationResponse):
    turns: list[ConversationTurnResponse]
    total: int
    limit: int
    offset: int
