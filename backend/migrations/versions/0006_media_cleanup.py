"""Durable file cleanup after transactional account removal."""
from alembic import op
import sqlalchemy as sa
revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('media_cleanup',sa.Column('storage_key',sa.String(64),primary_key=True),
                    sa.Column('created_at',sa.Float(),nullable=False))


def downgrade():
    op.drop_table('media_cleanup')
