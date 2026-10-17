"""Process-local demo store. Routers serialize access with the store lock."""
from datetime import datetime, timedelta, timezone
from threading import RLock
from uuid import uuid4

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
    def __init__(self, seed=True):
        self.lock = RLock()
        self.users = {}
        self.emails = {}
        self.passwords = {}
        self.tokens = {}
        self.interviews = {}
        self.owners = {}
        if seed:
            self.seed()

    def start(self, user_id, setup):
        ident = str(uuid4())
        interview = Interview(id=ident, setup=setup, startedAt=now(),
                              messages=[message(ident, 'ai', question(setup, 0))])
        self.interviews[ident] = interview
        self.owners[ident] = user_id
        return interview

    def find(self, user_id, ident):
        if self.owners.get(ident) != user_id:
            raise HTTPException(404, 'Interview not found.')
        return self.interviews[ident]

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
        return interview

    def seed(self):
        user = User(id='demo-user', name='Aruzhan', email='demo@example.com')
        self.users[user.id] = user
        self.emails[str(user.email)] = user.id
        self.passwords[user.id] = hasher.hash('demo-password')
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
