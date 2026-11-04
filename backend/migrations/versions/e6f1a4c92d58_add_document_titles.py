"""Add document titles

Revision ID: e6f1a4c92d58
Revises: d5a9c3e07b46
Create Date: 2026-11-04 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e6f1a4c92d58'
down_revision: Union[str, Sequence[str], None] = 'd5a9c3e07b46'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('documents', sa.Column('title', sa.String(length=200), nullable=True))
    op.add_column('documents', sa.Column('title_source', sa.String(length=10), nullable=True))
    op.create_check_constraint(
        'ck_documents_title_source',
        'documents',
        "title_source IS NULL OR title_source IN ('ai', 'user')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_documents_title_source', 'documents', type_='check')
    op.drop_column('documents', 'title_source')
    op.drop_column('documents', 'title')
