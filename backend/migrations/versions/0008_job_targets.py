"""Persist owner-scoped reusable job targets."""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'job_targets',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(120), nullable=False),
        sa.Column('company', sa.String(120), nullable=True),
        sa.Column('role', sa.String(40), nullable=False),
        sa.Column('description', sa.String(8000), nullable=False),
        sa.Column('created_at', sa.Float(), nullable=False),
        sa.Column('updated_at', sa.Float(), nullable=False),
    )
    op.create_index('ix_job_targets_owner_id', 'job_targets', ['owner_id'])


def downgrade():
    op.drop_index('ix_job_targets_owner_id', table_name='job_targets')
    op.drop_table('job_targets')
