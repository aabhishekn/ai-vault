"""Add document versions

Revision ID: c4e8f2b17d35
Revises: b7d3e1a94c20
Create Date: 2026-11-04 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c4e8f2b17d35'
down_revision: Union[str, Sequence[str], None] = 'b7d3e1a94c20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Every existing document becomes version 1 of its own group.
    """
    op.add_column('documents', sa.Column('group_id', sa.Uuid(), nullable=True))
    op.add_column('documents', sa.Column('version_number', sa.Integer(), server_default='1', nullable=False))
    op.add_column('documents', sa.Column('is_latest', sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column('documents', sa.Column('content_hash', sa.String(length=64), nullable=True))
    op.execute('UPDATE documents SET group_id = id')
    op.alter_column('documents', 'group_id', nullable=False)
    op.create_check_constraint('ck_documents_version_number', 'documents', 'version_number >= 1')
    op.create_unique_constraint('uq_documents_group_version', 'documents', ['group_id', 'version_number'])
    op.create_index('ix_documents_group_id', 'documents', ['group_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_documents_group_id', table_name='documents')
    op.drop_constraint('uq_documents_group_version', 'documents', type_='unique')
    op.drop_constraint('ck_documents_version_number', 'documents', type_='check')
    op.drop_column('documents', 'content_hash')
    op.drop_column('documents', 'is_latest')
    op.drop_column('documents', 'version_number')
    op.drop_column('documents', 'group_id')
