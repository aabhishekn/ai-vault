"""Add document category and tags

Revision ID: b7d3e1a94c20
Revises: 90ebf446aa5b
Create Date: 2026-11-04 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b7d3e1a94c20'
down_revision: Union[str, Sequence[str], None] = '90ebf446aa5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('documents', sa.Column('category', sa.String(length=40), nullable=True))
    op.add_column('documents', sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index('ix_documents_category', 'documents', ['category'])
    op.create_index('ix_documents_tags', 'documents', ['tags'], postgresql_using='gin')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_documents_tags', table_name='documents')
    op.drop_index('ix_documents_category', table_name='documents')
    op.drop_column('documents', 'tags')
    op.drop_column('documents', 'category')
