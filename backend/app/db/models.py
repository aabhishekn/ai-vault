from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import EMBEDDING_DIMENSIONS


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="ck_documents_positive_size"),
        CheckConstraint(
            "status IN ('queued', 'processing', 'extracted', 'embedded', 'ready', 'failed')",
            name="ck_documents_status",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(Text, unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), server_default="queued")
    extracted_pages: Mapped[list[dict] | None] = mapped_column(JSONB)
    summary: Mapped[str | None] = mapped_column(Text)
    insights: Mapped[list[dict] | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_document_chunks_position"),
        CheckConstraint("chunk_index >= 0", name="ck_document_chunks_index"),
        CheckConstraint("page_number > 0", name="ck_document_chunks_page"),
        CheckConstraint("length(text) > 0", name="ck_document_chunks_text"),
        CheckConstraint(
            "(embedding IS NULL AND embedding_model IS NULL) OR "
            "(embedding IS NOT NULL AND embedding_model IS NOT NULL)",
            name="ck_document_chunks_embedding_pair",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int]
    page_number: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(VECTOR(EMBEDDING_DIMENSIONS))
    embedding_model: Mapped[str | None] = mapped_column(String(100))


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (CheckConstraint("turn_count >= 0", name="ck_conversations_turn_count"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    turn_count: Mapped[int] = mapped_column(server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"
    __table_args__ = (
        UniqueConstraint("conversation_id", "turn_number", name="uq_conversation_turns_position"),
        CheckConstraint("turn_number > 0", name="ck_conversation_turns_number"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE")
    )
    turn_number: Mapped[int]
    response: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProcessingAttempt(Base):
    __tablename__ = "processing_attempts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('processing', 'succeeded', 'failed')", name="ck_processing_attempts_status"
        ),
        CheckConstraint("embedding_input_tokens >= 0", name="ck_processing_attempts_tokens"),
        CheckConstraint(
            "(status = 'processing' AND finished_at IS NULL AND duration_ms IS NULL) OR "
            "(status IN ('succeeded', 'failed') AND finished_at IS NOT NULL "
            "AND duration_ms IS NOT NULL AND duration_ms >= 0)",
            name="ck_processing_attempts_completion",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), server_default="processing")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None]
    embedding_input_tokens: Mapped[int] = mapped_column(server_default="0")
    error_message: Mapped[str | None] = mapped_column(Text)
