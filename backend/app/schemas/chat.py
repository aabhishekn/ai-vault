from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Passages sent to the model with a question. Too few and a list or a longer explanation is
# cut short; many more and the answer gets slower and less focused.
DEFAULT_TOP_K = 8


class SearchRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=DEFAULT_TOP_K, ge=1, le=20)

    @field_validator("question", mode="before")
    @classmethod
    def drop_nul_characters(cls, value):
        # PostgreSQL cannot store NUL in text or JSON; a question of only NULs is then empty.
        return value.replace("\x00", "") if isinstance(value, str) else value


class MessageRequest(SearchRequest):
    # Edit a question: answer this one in place of turn N, dropping N and any turns after it.
    replace_turn: int | None = Field(default=None, ge=1)


class SearchMatch(BaseModel):
    # Set when searching several documents, so each passage can name where it came from.
    document_id: UUID | None = None
    filename: str | None = None
    title: str | None = None  # the document's own title, when it has one
    chunk_id: UUID
    chunk_index: int
    page_number: int
    text: str
    cosine_distance: float


class SearchResponse(BaseModel):
    document_id: UUID | None  # None when the search spanned several documents
    question: str
    matches: list[SearchMatch]


class AnswerCitation(BaseModel):
    document_id: UUID | None = None
    filename: str | None = None
    title: str | None = None
    source_number: int
    chunk_id: UUID
    page_number: int
    text: str


class AnswerResponse(BaseModel):
    document_id: UUID | None  # None for an answer drawn from several documents
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
    document_id: UUID | None  # None for a multi-document conversation
    document_ids: list[UUID]
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


class MultiConversationRequest(BaseModel):
    document_ids: list[UUID] = Field(min_length=2, max_length=10)

    @field_validator("document_ids")
    @classmethod
    def at_least_two_distinct(cls, value: list[UUID]) -> list[UUID]:
        unique = list(dict.fromkeys(value))
        if len(unique) < 2:
            raise ValueError("Choose at least two different documents")
        return unique
