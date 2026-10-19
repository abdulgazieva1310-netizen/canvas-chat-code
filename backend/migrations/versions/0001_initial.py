"""Baseline schema; adopt existing create_all installations without deleting data.

Messages and interview configuration live in interviews.payload. Profiles live in
users.profile. Keep these definitions frozen as subsequent revisions are added.
"""
import sqlalchemy as sa
from alembic import op

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    metadata = sa.MetaData()
    sa.Table('users', metadata,
             sa.Column('id', sa.String(36), primary_key=True),
             sa.Column('email', sa.String(320), nullable=False, unique=True),
             sa.Column('password_hash', sa.String(512), nullable=False),
             sa.Column('profile', sa.JSON(), nullable=False))
    sa.Table('tokens', metadata,
             sa.Column('digest', sa.String(64), primary_key=True),
             sa.Column('user_id', sa.ForeignKey('users.id'), nullable=False, index=True),
             sa.Column('expires_at', sa.Float(), nullable=False))
    sa.Table('interviews', metadata,
             sa.Column('id', sa.String(36), primary_key=True),
             sa.Column('owner_id', sa.ForeignKey('users.id'), nullable=False, index=True),
             sa.Column('started_at', sa.Float(), nullable=False),
             sa.Column('status', sa.String(16), nullable=False),
             sa.Column('payload', sa.JSON(), nullable=False),
             sa.Column('version', sa.Integer(), nullable=False))
    sa.Table('answer_evaluations', metadata,
             sa.Column('answer_id', sa.String(36), primary_key=True),
             sa.Column('interview_id', sa.ForeignKey('interviews.id'), nullable=False, index=True),
             sa.Column('question_id', sa.String(36), nullable=False),
             sa.Column('result', sa.JSON(), nullable=True))
    metadata.create_all(op.get_bind(), checkfirst=True)
