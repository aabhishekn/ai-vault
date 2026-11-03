from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


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
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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
    embedding: Mapped[list[float] | None] = mapped_column(VECTOR(1536))
    embedding_model: Mapped[str | None] = mapped_column(String(100))
