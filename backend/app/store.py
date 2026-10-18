"""Transactional database repository and deterministic interview fixtures."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from .database import Base, InterviewRecord, TokenRecord, UserRecord, database_engine

from fastapi import HTTPException

from .auth import hasher
from .models import Feedback, Interview, InterviewSetup, Message, QuestionFeedback, Scores, User


def now():
    return datetime.now(timezone.utc)


def message(interview_id, sender, text):
    return Message(id=str(uuid4()), interviewId=interview_id, **{'from': sender}, text=text, createdAt=now())


def question(setup, index):
    prompts = (['Tell me about a difficult problem you solved.', 'Describe a disagreement with a teammate.',
                'How did you respond to critical feedback?'] if setup.type == 'Behavioral' else
               [f'Describe a core concept you use as a {setup.role}.', 'How would you investigate a production issue?',
                'What trade-offs would you consider when designing a reliable system?'])
    return f'Question {index + 1} ({setup.level}): {prompts[index % len(prompts)]}'


def report(interview):
    answers = [m for m in interview.messages if m.sender == 'you']
    questions = [m for m in interview.messages if m.sender == 'ai']
    return Feedback(interviewId=interview.id, overall=6.9 if answers else None,
                    scores=Scores() if answers else None,
                    strengths=['You provided an answer to the question.'] if answers else [],
                    gaps=['Practice adding concrete examples and measurable results.'] if answers else [],
                    questions=[QuestionFeedback(q=q.text, answer=a.text, score=6.9,
                        good='You engaged with the question.', miss='Consider explaining trade-offs and edge cases.',
                        better='State the situation, describe your approach with a concrete example, and close with the result.')
                        for q, a in zip(questions, answers)])


class Store:
    def __init__(self, seed=True, database_url=None):
        self.engine = database_engine(database_url)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)
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

    def start(self, user_id, setup):
        ident = str(uuid4())
        interview = Interview(id=ident, setup=setup, startedAt=now(),
                              messages=[message(ident, 'ai', question(setup, 0))])
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

    def answer(self, interview, text):
        if interview.status != 'active':
            raise HTTPException(409, 'This interview has ended.')
        interview.messages.append(message(interview.id, 'you', text.strip()))
        interview.answeredCount += 1
        interview.lastFeedback = Scores() if interview.setup.mode == 'Practice' else None
        if interview.answeredCount == interview.setup.questionCount:
            interview.status = 'complete'
            interview.endedAt = now()
        else:
            interview.messages.append(message(interview.id, 'ai', question(interview.setup, interview.answeredCount)))
        self.save(interview)
        return interview

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
