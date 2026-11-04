from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ComparisonRequest(BaseModel):
    document_ids: list[UUID] = Field(min_length=2, max_length=5)
    # Optional aspect to compare, such as "payment terms" or "security requirements".
    focus: str | None = Field(default=None, max_length=200)

    @field_validator("document_ids")
    @classmethod
    def distinct(cls, value: list[UUID]) -> list[UUID]:
        unique = list(dict.fromkeys(value))
        if len(unique) < 2:
            raise ValueError("Choose at least two different documents")
        return unique

    @field_validator("focus")
    @classmethod
    def clean_focus(cls, value: str | None) -> str | None:
        return " ".join(value.split()) or None if value else None


class ComparedDocument(BaseModel):
    id: UUID
    filename: str
    version_number: int


class ComparisonPosition(BaseModel):
    document_id: UUID
    filename: str
    statement: str


class ComparisonDifference(BaseModel):
    topic: str
    positions: list[ComparisonPosition]


class ComparisonResponse(BaseModel):
    documents: list[ComparedDocument]
    focus: str | None
    overview: str
    similarities: list[str]
    differences: list[ComparisonDifference]
    model: str
    cached: bool = False
