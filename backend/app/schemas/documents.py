from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_TITLE_CHARACTERS = 120


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    filename: str
    # Null until the document is classified or renamed; clients then show the file name.
    title: str | None = None
    title_source: Literal["ai", "user"] | None = None
    content_type: str
    size_bytes: int
    status: str
    # Why processing failed, in words a person can act on; null unless the document failed.
    error_message: str | None = None
    group_id: UUID | None = None
    version_number: int = 1
    is_latest: bool = True
    category: str | None = None
    created_at: datetime


class DocumentUpdate(BaseModel):
    """A new display title. Null or blank removes it, so the file name is shown again."""

    title: str | None = Field(max_length=MAX_TITLE_CHARACTERS * 2)

    @field_validator("title")
    @classmethod
    def tidy_title(cls, value: str | None) -> str | None:
        value = " ".join(value.split()) if value else None
        if value and len(value) > MAX_TITLE_CHARACTERS:
            raise ValueError(f"Title must be at most {MAX_TITLE_CHARACTERS} characters")
        return value or None


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    total: int
    limit: int
    offset: int


class SummaryResponse(BaseModel):
    document_id: UUID
    summary: str


class SummaryOptions(BaseModel):
    """How a custom summary should read; the defaults match the saved summary."""

    length: Literal["short", "medium", "long"] = "medium"
    tone: Literal["neutral", "formal", "casual", "executive"] = "neutral"
    focus: str | None = Field(default=None, max_length=200)

    @field_validator("focus")
    @classmethod
    def blank_focus_means_none(cls, value: str | None) -> str | None:
        value = " ".join(value.split()) if value else None
        return value or None


class CustomSummaryResponse(BaseModel):
    document_id: UUID
    summary: str
    options: SummaryOptions
    cached: bool


class DocumentInsight(BaseModel):
    text: str
    page_number: int
    evidence: str


class SuggestedQuestionsResponse(BaseModel):
    document_id: UUID
    questions: list[str]
    cached: bool


class InsightsResponse(BaseModel):
    document_id: UUID
    insights: list[DocumentInsight]


class ClassificationResponse(BaseModel):
    document_id: UUID
    category: str
    title: str | None = None


class DocumentVersion(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    version_number: int
    filename: str
    title: str | None = None
    size_bytes: int
    status: str
    is_latest: bool
    created_at: datetime


class DocumentVersionsResponse(BaseModel):
    group_id: UUID
    versions: list[DocumentVersion]
