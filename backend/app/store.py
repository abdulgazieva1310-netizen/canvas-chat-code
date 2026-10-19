"""Transactional database repository and deterministic interview fixtures."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from .database import AnswerEvaluationRecord, InterviewRecord, TokenRecord, UserRecord, database_engine
from .migrate import upgrade_database

from fastapi import HTTPException

from .auth import hasher
from .models import CODING_ROLES, AnswerEvaluation, Feedback, Interview, InterviewSetup, Message, QuestionFeedback, Scores, User


def now():
    return datetime.now(timezone.utc)


def message(interview_id, sender, text):
    return Message(id=str(uuid4()), interviewId=interview_id, **{'from': sender}, text=text, createdAt=now())


def answer_text(setup, text):
    return text if setup.type == 'Technical' and setup.role in CODING_ROLES else text.strip()


def question(setup, index):
    if setup.type == 'Technical' and setup.role in CODING_ROLES:
        language = {'Java Developer': 'Java', 'Python Developer': 'Python',
                    'C++ Developer': 'C++'}.get(setup.role, 'a language of your choice')
        prompts = [
            'Given an integer array nums and a target, return indices of two distinct elements '
            'whose sum equals target. Exactly one solution exists. Constraints: 2 <= len(nums) <= 10000; '
            'values and target are between -1000000 and 1000000. Example: [2,7,11,15], target=9 -> [0,1].',
            'Given a string s, return the length of its longest substring without repeated characters. '
            'Constraints: 0 <= len(s) <= 100000 ASCII characters. Example: "abcabcbb" -> 3.',
            'Given a list of closed intervals [start,end], merge all overlapping intervals and return '
            'the result sorted by start. Constraints: 1 <= len(intervals) <= 10000; '
            '0 <= start <= end <= 1000000. Example: [[1,3],[2,6],[8,10]] -> [[1,6],[8,10]].',
        ]
        return (f'Question {index + 1} ({setup.level}): {prompts[index % len(prompts)]} '
                f'Implement in {language} and explain time and space complexity.')
    prompts = (['Tell me about a difficult problem you solved.', 'Describe a disagreement with a teammate.',
                'How did you respond to critical feedback?'] if setup.type == 'Behavioral' else
               [f'Describe a core concept you use as a {setup.role}.', 'How would you investigate a production issue?',
                'What trade-offs would you consider when designing a reliable system?'])
    return f'Question {index + 1} ({setup.level}): {prompts[index % len(prompts)]}'


def report(interview, evaluations=None):
    evaluations = evaluations or {}
    answers = [m for m in interview.messages if m.sender == 'you']
    questions = [m for m in interview.messages if m.sender == 'ai']
    evaluated = [evaluations[a.id] for a in answers if evaluations.get(a.id) is not None]
    scores = Scores(**{name: round(sum(getattr(e, name) for e in evaluated) / len(evaluated), 1)
                       for name in Scores.model_fields}) if evaluated else None
    overall = round(sum(sum(getattr(e, name) for name in Scores.model_fields) / 4
                        for e in evaluated) / len(evaluated), 1) if evaluated else None
    feedback = []
    for q, a in zip(questions, answers):
        evaluation = evaluations.get(a.id)
        feedback.append(QuestionFeedback(q=q.text, answer=a.text,
            score=round(sum(getattr(evaluation, name) for name in Scores.model_fields) / 4, 1)
                if evaluation else None,
            scores=evaluation.category_scores() if evaluation else None,
            good=evaluation.went_well if evaluation else 'AI evaluation unavailable for this answer.',
            miss=evaluation.missing if evaluation else 'This answer has not been scored.',
            better=evaluation.stronger_answer if evaluation else 'Try another interview when AI evaluation is available.'))
    return Feedback(interviewId=interview.id, overall=overall, scores=scores,
        strengths=list(dict.fromkeys(e.went_well for e in evaluated)),
        gaps=list(dict.fromkeys(e.missing for e in evaluated)), questions=feedback)


class Store:
    def __init__(self, seed=True, database_url=None):
        self.engine = database_engine(database_url)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        upgrade_database(self.engine)
        if seed:
            try:
                with self.transaction() as repository:
                    if repository.session.get(UserRecord, 'demo-user') is None:
                        repository.seed()
            except IntegrityError:
                # Another worker may have seeded the same account first.
                with self.sessions() as session:
                    if session.get(UserRecord, 'demo-user') is None:
                        raise

    @contextmanager
    def transaction(self):
        try:
            with self.sessions.begin() as session:
                yield Repository(session)
        except StaleDataError as exc:
            raise HTTPException(409, 'Interview changed. Reload and try again.') from exc


class Repository:
    def __init__(self, session):
        self.session = session
        self.loaded = {}

    def user_by_email(self, email):
        return self.session.scalar(select(UserRecord).where(UserRecord.email == email))

    def add_user(self, user, password_hash):
        self.session.add(UserRecord(id=user.id, email=str(user.email),
                                    password_hash=password_hash, profile=user.model_dump(mode='json')))
        self.session.flush()

    def add_token(self, digest, user_id, expires_at):
        self.session.add(TokenRecord(digest=digest, user_id=user_id, expires_at=expires_at.timestamp()))

    def revoke_tokens(self, digests):
        if digests:
            self.session.execute(delete(TokenRecord).where(TokenRecord.digest.in_(digests)))

    def update_profile(self, user_id, data):
        record = self.session.get(UserRecord, user_id)
        user = User.model_validate(record.profile)
        user = user.model_copy(update={
            'name': data.name.strip(), 'targetRole': data.targetRole, 'level': data.level,
            'preferredLanguage': (data.preferredLanguage.strip() if 'preferredLanguage' in data.model_fields_set
                                  else user.preferredLanguage)})
        record.profile = user.model_dump(mode='json')
        return user

    def token_user(self, digest):
        token = self.session.get(TokenRecord, digest)
        if token is None or token.expires_at <= now().timestamp():
            return None
        return User.model_validate(self.session.get(UserRecord, token.user_id).profile)

    def save(self, interview):
        record = self.loaded.get(interview.id) or self.session.get(InterviewRecord, interview.id)
        record.payload = interview.model_dump(mode='json', by_alias=True)
        record.status = interview.status
        record.started_at = interview.startedAt.timestamp()

    def history(self, user_id):
        records = self.session.scalars(select(InterviewRecord).where(
            InterviewRecord.owner_id == user_id, InterviewRecord.status != 'active'
        ).order_by(InterviewRecord.started_at.desc(), InterviewRecord.id))
        return [Interview.model_validate(record.payload) for record in records]

    def start(self, user_id, setup, first_question=None):
        ident = str(uuid4())
        interview = Interview(id=ident, setup=setup, startedAt=now(),
                              messages=[message(ident, 'ai', first_question or question(setup, 0))])
        self.session.add(InterviewRecord(id=ident, owner_id=user_id,
            started_at=interview.startedAt.timestamp(), status=interview.status,
            payload=interview.model_dump(mode='json', by_alias=True)))
        self.session.flush()
        return interview

    def find(self, user_id, ident):
        record = self.session.scalar(select(InterviewRecord).where(
            InterviewRecord.id == ident, InterviewRecord.owner_id == user_id).with_for_update())
        if record is None:
            raise HTTPException(404, 'Interview not found.')
        self.loaded[ident] = record
        return Interview.model_validate(record.payload)

    def resume(self, interview):
        if interview.status == 'complete' or interview.answeredCount >= interview.setup.questionCount:
            raise HTTPException(409, 'Completed interviews cannot be resumed.')
        if interview.status == 'incomplete':
            interview.status = 'active'
            interview.endedAt = None
            self.save(interview)
        return interview

    def delete(self, user_id, ident):
        self.find(user_id, ident)  # Ownership check and row lock before deleting children.
        self.session.execute(delete(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == ident))
        # The transcript (including all messages) lives in the interview payload.
        self.session.delete(self.loaded[ident])

    def answer(self, interview, text, next_question=None, evaluation=None):
        if interview.status != 'active':
            raise HTTPException(409, 'This interview has ended.')
        question_message = next(m for m in reversed(interview.messages) if m.sender == 'ai')
        answer_message = message(interview.id, 'you', answer_text(interview.setup, text))
        interview.messages.append(answer_message)
        self.session.add(AnswerEvaluationRecord(answer_id=answer_message.id,
            interview_id=interview.id, question_id=question_message.id,
            result=evaluation.model_dump(mode='json') if evaluation else None))
        interview.answeredCount += 1
        interview.lastFeedback = evaluation.category_scores() if evaluation and interview.setup.mode == 'Practice' else None
        interview.lastAnswerFeedback = evaluation if interview.setup.mode == 'Practice' else None
        if interview.answeredCount == interview.setup.questionCount:
            interview.status = 'complete'
            interview.endedAt = now()
        else:
            interview.messages.append(message(interview.id, 'ai', next_question or question(interview.setup, interview.answeredCount)))
        self.save(interview)
        return interview

    def report(self, interview):
        records = self.session.scalars(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview.id))
        evaluations = {record.answer_id: AnswerEvaluation.model_validate(record.result)
                       if record.result else None for record in records}
        return report(interview, evaluations)

    def seed(self):
        user = User(id='demo-user', name='Aruzhan', email='demo@example.com')
        self.add_user(user, hasher.hash('demo-password'))
        for days, mode, count in [(3, 'Practice', 5), (1, 'Real Interview', 2)]:
            setup = InterviewSetup(role='Frontend Developer', level='Middle', mode=mode,
                                  questionCount=5, type='Technical', input='Text', language='English')
            interview = self.start(user.id, setup)
            for _ in range(count):
                self.answer(interview, 'I reproduced the issue, compared alternative approaches, and verified the result with tests and metrics.')
            if interview.status == 'active':
                interview.status = 'incomplete'
                interview.endedAt = now()
            interview.startedAt -= timedelta(days=days)
            interview.endedAt -= timedelta(days=days)
            for msg in interview.messages:
                msg.createdAt -= timedelta(days=days)
            self.save(interview)
