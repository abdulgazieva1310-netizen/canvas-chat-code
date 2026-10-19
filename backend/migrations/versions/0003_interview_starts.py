"""Durable owner-scoped interview creation keys."""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('interview_starts',
                    sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), primary_key=True),
                    sa.Column('key', sa.String(128), primary_key=True),
                    sa.Column('setup', sa.JSON(), nullable=False),
                    sa.Column('interview_id', sa.String(36), nullable=False))
