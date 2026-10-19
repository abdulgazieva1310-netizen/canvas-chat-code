"""Persist hashed, expiring recovery credentials."""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('password_resets',
                    sa.Column('digest', sa.String(64), primary_key=True),
                    sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
                    sa.Column('expires_at', sa.Float(), nullable=False))
    op.create_index('ix_password_resets_user_id', 'password_resets', ['user_id'])
