"""Add multi-document conversations

Revision ID: d5a9c3e07b46
Revises: c4e8f2b17d35
Create Date: 2026-11-04 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd5a9c3e07b46'
down_revision: Union[str, Sequence[str], None] = 'c4e8f2b17d35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    A conversation with no document_id spans the documents listed in
    conversation_documents; single-document conversations are unchanged.
    """
    op.alter_column('conversations', 'document_id', existing_type=sa.Uuid(), nullable=True)
    op.create_table(
        'conversation_documents',
        sa.Column('conversation_id', sa.Uuid(), nullable=False),
        sa.Column('document_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('conversation_id', 'document_id'),
    )
    op.create_index('ix_conversation_documents_document_id', 'conversation_documents', ['document_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_conversation_documents_document_id', table_name='conversation_documents')
    op.drop_table('conversation_documents')
    op.execute('DELETE FROM conversations WHERE document_id IS NULL')
    op.alter_column('conversations', 'document_id', existing_type=sa.Uuid(), nullable=False)
