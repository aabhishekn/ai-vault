"""Add embedded document status.

Revision ID: 5621f72fa029
Revises: 92c3095dd0bd
"""
from alembic import op

revision = "5621f72fa029"
down_revision = "92c3095dd0bd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_documents_status", "documents", type_="check")
    op.create_check_constraint(
        "ck_documents_status", "documents",
        "status IN ('queued', 'processing', 'extracted', 'embedded', 'ready', 'failed')",
    )


def downgrade() -> None:
    op.execute("UPDATE documents SET status = 'extracted' WHERE status = 'embedded'")
    op.drop_constraint("ck_documents_status", "documents", type_="check")
    op.create_check_constraint(
        "ck_documents_status", "documents",
        "status IN ('queued', 'processing', 'extracted', 'ready', 'failed')",
    )
