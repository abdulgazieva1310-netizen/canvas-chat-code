"""Add owner-scoped evidence-based study plans."""
from alembic import op
import sqlalchemy as sa

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'study_plans',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('source_interview_ids', sa.JSON(), nullable=False),
        sa.Column('comparison_group', sa.JSON(), nullable=False),
        sa.Column('items', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.Float(), nullable=False),
        sa.Column('updated_at', sa.Float(), nullable=False),
    )
    op.create_index('ix_study_plans_owner_id', 'study_plans', ['owner_id'])


def downgrade():
    op.drop_index('ix_study_plans_owner_id', table_name='study_plans')
    op.drop_table('study_plans')
