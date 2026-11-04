from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, object_session

from app.core.config import EMBEDDING_DIMENSIONS


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="ck_documents_positive_size"),
        CheckConstraint("version_number >= 1", name="ck_documents_version_number"),
        UniqueConstraint("group_id", "version_number", name="uq_documents_group_version"),
        CheckConstraint(
            "status IN ('queued', 'processing', 'extracted', 'embedded', 'ready', 'failed')",
            name="ck_documents_status",
        ),
        # Serves `tags @> '["x"]'` filters (see the category and tags migration).
        Index("ix_documents_tags", "tags", postgresql_using="gin"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(Text, unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int]
    # Versions of one document share a group; the first version's id names it.
    group_id: Mapped[UUID] = mapped_column(
        index=True, default=lambda context: context.get_current_parameters()["id"]
    )
    version_number: Mapped[int] = mapped_column(server_default="1")
    is_latest: Mapped[bool] = mapped_column(server_default=true())
    content_hash: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), server_default="queued")
    extracted_pages: Mapped[list[dict] | None] = mapped_column(JSONB)
    summary: Mapped[str | None] = mapped_column(Text)
    insights: Mapped[list[dict] | None] = mapped_column(JSONB)
    category: Mapped[str | None] = mapped_column(String(40), index=True)
    tags: Mapped[list[str] | None] = mapped_column(JSONB)
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


class ConversationDocument(Base):
    """A document in the scope of a multi-document conversation."""

    __tablename__ = "conversation_documents"
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (CheckConstraint("turn_count >= 0", name="ck_conversations_turn_count"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    # Set for a conversation about one document; None when it spans several (see
    # ConversationDocument).
    document_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    turn_count: Mapped[int] = mapped_column(server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def document_ids(self) -> list[UUID]:
        """The documents this conversation can draw on."""
        if self.document_id is not None:
            return [self.document_id]
        session = object_session(self)
        if session is None:
            return []
        return list(
            session.scalars(
                select(ConversationDocument.document_id)
                .where(ConversationDocument.conversation_id == self.id)
                .order_by(ConversationDocument.document_id)
            )
        )


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
