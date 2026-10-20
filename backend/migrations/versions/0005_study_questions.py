"""Private saved question references and notes."""
from alembic import op
import sqlalchemy as sa
revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('study_questions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('interview_id', sa.String(36), sa.ForeignKey('interviews.id'), nullable=False),
        sa.Column('question_id', sa.String(36), nullable=False),
        sa.Column('note', sa.String(4000), nullable=False),
        sa.Column('saved_at', sa.Float(), nullable=False),
        sa.UniqueConstraint('owner_id','interview_id','question_id',name='uq_study_question'))
    op.create_index('ix_study_questions_owner_id','study_questions',['owner_id'])
    op.create_index('ix_study_questions_interview_id','study_questions',['interview_id'])


def downgrade():
    op.drop_table('study_questions')
