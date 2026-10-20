"""Persist owner-scoped interview setup presets."""
from alembic import op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'setup_presets',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('name_key', sa.String(256), nullable=False),
        sa.Column('role', sa.String(40), nullable=False),
        sa.Column('level', sa.String(16), nullable=False),
        sa.Column('type', sa.String(24), nullable=False),
        sa.Column('mode', sa.String(24), nullable=False),
        sa.Column('input', sa.String(16), nullable=False),
        sa.Column('question_count', sa.Integer(), nullable=False),
        sa.Column('language', sa.String(16), nullable=False),
        sa.Column('created_at', sa.Float(), nullable=False),
        sa.Column('updated_at', sa.Float(), nullable=False),
        sa.UniqueConstraint('owner_id', 'name_key', name='uq_setup_preset_owner_name'),
    )
    op.create_index('ix_setup_presets_owner_id', 'setup_presets', ['owner_id'])


def downgrade():
    op.drop_index('ix_setup_presets_owner_id', table_name='setup_presets')
    op.drop_table('setup_presets')
