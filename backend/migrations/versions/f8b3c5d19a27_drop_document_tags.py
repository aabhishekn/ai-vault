"""Drop document tags and the category index

Revision ID: f8b3c5d19a27
Revises: e6f1a4c92d58
Create Date: 2026-11-05 18:30:00.000000

Tags are gone and the list is searched by words instead of filtered, so the tag index, the
category index and the tags column are no longer used. The category column stays. Downgrading
restores the empty column and both indexes; the tags themselves are not recoverable.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f8b3c5d19a27'
down_revision: Union[str, Sequence[str], None] = 'e6f1a4c92d58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index('ix_documents_tags', table_name='documents')
    op.drop_index('ix_documents_category', table_name='documents')
    op.drop_column('documents', 'tags')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('documents', sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index('ix_documents_category', 'documents', ['category'])
    op.create_index('ix_documents_tags', 'documents', ['tags'], postgresql_using='gin')
