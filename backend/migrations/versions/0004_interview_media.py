"""Consent records and private expiring interview media."""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('interview_media_consents',
        sa.Column('interview_id', sa.String(36), sa.ForeignKey('interviews.id'), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('consented_at', sa.Float(), nullable=False))
    op.create_index('ix_interview_media_consents_owner_id', 'interview_media_consents', ['owner_id'])
    op.create_table('interview_media',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('interview_id', sa.String(36), sa.ForeignKey('interviews.id'), nullable=False),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('storage_key', sa.String(64), nullable=False, unique=True),
        sa.Column('media_type', sa.String(80), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.Float(), nullable=False),
        sa.Column('expires_at', sa.Float(), nullable=False))
    op.create_index('ix_interview_media_interview_id', 'interview_media', ['interview_id'])
    op.create_index('ix_interview_media_owner_id', 'interview_media', ['owner_id'])
    op.create_index('ix_interview_media_expires_at', 'interview_media', ['expires_at'])


def downgrade():
    op.drop_table('interview_media')
    op.drop_table('interview_media_consents')
