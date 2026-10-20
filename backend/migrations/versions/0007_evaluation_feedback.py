"""Private user feedback for saved answer evaluations."""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'evaluation_feedback',
        sa.Column('answer_id', sa.String(36), sa.ForeignKey('answer_evaluations.answer_id'), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('interview_id', sa.String(36), sa.ForeignKey('interviews.id'), nullable=False),
        sa.Column('question_id', sa.String(36), nullable=False),
        sa.Column('rating', sa.String(20), nullable=False),
        sa.Column('category', sa.String(32), nullable=True),
        sa.Column('comment', sa.String(1000), nullable=True),
        sa.Column('provenance', sa.JSON(), nullable=True),
        sa.Column('updated_at', sa.Float(), nullable=False),
    )
    op.create_index('ix_evaluation_feedback_owner_id', 'evaluation_feedback', ['owner_id'])
    op.create_index('ix_evaluation_feedback_interview_id', 'evaluation_feedback', ['interview_id'])


def downgrade():
    op.drop_index('ix_evaluation_feedback_interview_id', table_name='evaluation_feedback')
    op.drop_index('ix_evaluation_feedback_owner_id', table_name='evaluation_feedback')
    op.drop_table('evaluation_feedback')
