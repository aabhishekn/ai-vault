"""Enable pgvector and add chunk embeddings.

Revision ID: 92c3095dd0bd
Revises: 43a176b51475
"""
from alembic import op
from pgvector.sqlalchemy import VECTOR
import sqlalchemy as sa

revision = "92c3095dd0bd"
down_revision = "43a176b51475"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("document_chunks", sa.Column("embedding", VECTOR(1536), nullable=True))
    op.add_column("document_chunks", sa.Column("embedding_model", sa.String(100), nullable=True))
    op.create_check_constraint(
        "ck_document_chunks_embedding_pair", "document_chunks",
        "(embedding IS NULL AND embedding_model IS NULL) OR "
        "(embedding IS NOT NULL AND embedding_model IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_document_chunks_embedding_pair", "document_chunks", type_="check")
    op.drop_column("document_chunks", "embedding_model")
    op.drop_column("document_chunks", "embedding")
    # Keep the extension: other tables may also depend on it.
