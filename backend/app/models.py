"""Wire models use the frontend's camelCase field names."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

Role = Literal['Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'Java Developer',
               'Python Developer', 'C++ Developer', 'QA Engineer', 'Data Analyst', 'DevOps Engineer']
CODING_ROLES = frozenset({'Java Developer', 'Python Developer', 'C++ Developer',
                          'Backend Developer', 'Full Stack Developer'})
CODING_LANGUAGES = {'Java Developer': 'Java', 'Python Developer': 'Python', 'C++ Developer': 'C++'}
Level = Literal['Junior', 'Middle', 'Senior']


class LoginData(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RegisterData(LoginData):
    name: str = Field(min_length=1, pattern=r'\S')
    targetRole: Role = 'Frontend Developer'
    level: Level = 'Middle'


class ResetRequest(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    token: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1)


class User(BaseModel):
    id: str
    name: str
    email: EmailStr
    targetRole: Role = 'Frontend Developer'
    level: Level = 'Middle'
    preferredLanguage: str = Field(default='English', min_length=1, max_length=80, pattern=r'\S')


class ProfileUpdate(BaseModel):
    model_config = {'extra': 'forbid'}
    name: str = Field(min_length=1, pattern=r'\S')
    targetRole: Role
    level: Level
    preferredLanguage: str = Field(default='English', min_length=1, max_length=80, pattern=r'\S')


class InterviewSetup(BaseModel):
    role: Role
    level: Level
    mode: Literal['Practice', 'Real Interview']
    questionCount: Literal[5, 10, 15]
    type: Literal['Technical', 'Behavioral', 'Role-specific']
    input: Literal['Voice', 'Text']
    language: Literal['English']
    jobDescription: str = ""
    practiceTopic: str | None = Field(default=None, min_length=1, max_length=120, pattern=r'\S',
                                     exclude_if=lambda value: value is None)

    @field_validator('practiceTopic')
    @classmethod
    def clean_practice_topic(cls, value):
        return value.strip() if value is not None else None

    @model_validator(mode='after')
    def topic_requires_practice_mode(self):
        if self.practiceTopic is not None and self.mode != 'Practice':
            raise ValueError('practiceTopic is only available in Practice mode')
        return self

    @field_validator('questionCount', mode='before')
    @classmethod
    def integer_count(cls, value):
        if type(value) is not int:
            raise ValueError('questionCount must be an integer')
        return value


class Answer(BaseModel):
    selectedLanguage: Literal['Python', 'Java', 'C++', 'JavaScript', 'TypeScript'] | None = None
    text: str = Field(min_length=1, pattern=r'\S')


class Message(BaseModel):
    id: str
    interviewId: str
    sender: Literal['ai', 'you', 'hint'] = Field(alias='from')
    text: str
    createdAt: datetime


class Scores(BaseModel):
    accuracy: float = Field(ge=1, le=10, strict=True, allow_inf_nan=False)
    completeness: float = Field(ge=1, le=10, strict=True, allow_inf_nan=False)
    clarity: float = Field(ge=1, le=10, strict=True, allow_inf_nan=False)
    structure: float = Field(ge=1, le=10, strict=True, allow_inf_nan=False)


class AnswerEvaluation(Scores):
    went_well: str = Field(min_length=1, pattern=r'\S', max_length=10000)
    missing: str = Field(min_length=1, pattern=r'\S', max_length=10000)
    stronger_answer: str = Field(min_length=1, pattern=r'\S', max_length=10000)

    def category_scores(self):
        return Scores(**{name: getattr(self, name) for name in Scores.model_fields})


class Interview(BaseModel):
    id: str
    setup: InterviewSetup
    status: Literal['active', 'complete', 'incomplete'] = 'active'
    startedAt: datetime
    endedAt: datetime | None = None
    answeredCount: int = 0
    messages: list[Message]
    lastFeedback: Scores | None = None
    lastAnswerFeedback: AnswerEvaluation | None = None


class QuestionFeedback(BaseModel):
    q: str
    answer: str
    score: float | None
    scores: Scores | None = None
    good: str
    miss: str
    better: str


class Feedback(BaseModel):
    interviewId: str
    overall: float | None
    scores: Scores | None
    strengths: list[str]
    gaps: list[str]
    questions: list[QuestionFeedback]


class InterviewReport(BaseModel):
    interview: Interview
    feedback: Feedback


class EvidenceReference(BaseModel):
    interviewId: str
    answerId: str


class EvidenceClaim(BaseModel):
    text: str
    sources: list[EvidenceReference]


class PracticeSuggestion(BaseModel):
    topic: str
    setup: InterviewSetup
    sources: list[EvidenceReference]


class DashboardTrend(BaseModel):
    interviewId: str
    date: datetime
    overall: float


class DashboardGroup(BaseModel):
    role: Role
    type: Literal['Technical', 'Behavioral', 'Role-specific']
    mode: Literal['Practice', 'Real Interview']
    level: Level
    scoredCount: int
    overall: float | None
    scores: dict[str, float | None]
    trends: list[DashboardTrend]


class DashboardSummary(BaseModel):
    completedCount: int
    recentActivity: list[Interview]
    groups: list[DashboardGroup]
    strengths: list[EvidenceClaim]
    weaknesses: list[EvidenceClaim]
    suggestions: list[PracticeSuggestion]
