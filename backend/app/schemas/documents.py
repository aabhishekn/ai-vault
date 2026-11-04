from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    status: str
    category: str | None = None
    tags: list[str] = []
    created_at: datetime

    @field_validator("tags", mode="before")
    @classmethod
    def no_tags_means_empty(cls, value: list[str] | None) -> list[str]:
        return value or []


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
    tags: list[str]


class TagCount(BaseModel):
    tag: str
    count: int


class CategoryCount(BaseModel):
    category: str
    count: int


class TagsOverviewResponse(BaseModel):
    categories: list[CategoryCount]
    tags: list[TagCount]
