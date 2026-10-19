"""Transactional database repository and deterministic interview fixtures."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import re
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from .database import AnswerEvaluationRecord, InterviewRecord, TokenRecord, UserRecord, database_engine
from .migrate import upgrade_database

from fastapi import HTTPException

from .auth import hasher
from .services.question_bank import BankError, load_bank
from .models import (CODING_ROLES, AnswerEvaluation, CodingJudgeSummary, DashboardGroup, DashboardSummary, DashboardTrend,
                     DifficultyDecision,
                     EvidenceClaim, EvidenceReference, Feedback, Interview, InterviewSetup, Message,
                     QuestionFeedback, Scores, User)
from .services.difficulty import transition as difficulty_transition


def now():
    return datetime.now(timezone.utc)


def message(interview_id, sender, text, *, kind='main', main_question_id=None):
    return Message(id=str(uuid4()), interviewId=interview_id, **{'from': sender}, text=text,
                   createdAt=now(), kind=kind, mainQuestionId=main_question_id)


def answer_text(setup, text):
    return text if setup.type == 'Technical' and setup.role in CODING_ROLES else text.strip()


def positive_observation(text):
    value = ' '.join(text.split()).strip()
    if not value:
        return ''
    if value.casefold() in {'none', 'null', '[]', 'no specific strengths identified'}:
        return ''
    if re.search(
        r'\b(no relevant information|not relevant|irrelevant|does not|doesn.t|did not|didn.t|'
        r'fails? to|failed to|contains no relevant|lacks?|missing|omits?|omitted|insufficient|'
        r'inadequate|attempted to answer|albeit|unrelated|random (?:letters?|token|text)|gibberish|'
        r'nonsensical|single unrelated token|(?:too|extremely|overly) brief)\b',
        value, re.IGNORECASE,
    ):
        return ''
    return value


def practice_topics(missing, suggested=None):
    if re.search(r'\b(?:no relevant information|no answer was provided|not answered)\b', missing, re.I):
        return []
    candidates = [suggested] if suggested else []
    for part in re.split(r'[\n;•]+', missing):
        value = re.sub(r'^\s*[-*\d.)]+\s*', '', part).strip()
        value = re.sub(r'^(?:the (?:candidate|response|answer|user)|your answer|you)\s+', '', value, flags=re.I)
        value = re.sub(r'^(?:missing|weakness(?:es)?)(?:\s+include)?\s*:?\s*', '', value, flags=re.I)
        value = re.sub(r'^(?:missed|lacks?|omitted|is missing)\s+', '', value, flags=re.I)
        value = re.sub(
            r"^(?:(?:does not|doesn't|did not|didn't|fails to|failed to|needs to|should|must|omits|lacks|missed|forgot to|is missing)\s+)?"
            r"(?:(?:adequately|clearly|sufficiently)\s+)?(?:address|answer|explain|describe|discuss|include|mention|identify|provide|show|cover|improve|practice|strengthen|learn|apply|use)\s+",
            '', value, flags=re.I,
        )
        value = re.sub(
            r'^(?:an?\s+)?(?:clear\s+)?(?:description|explanation|discussion|understanding|coverage|treatment)\s+of\s+',
            '', value, flags=re.I,
        )
        value = re.sub(
            r'^(?:not enough detail|insufficient detail|limited detail|lack of detail|insufficient discussion)\s+(?:about|of)\s+',
            '', value, flags=re.I,
        )
        candidates.extend(re.split(r'\s*(?:,|\band\b|\bor\b|&)\s*', value, flags=re.I))

    result = []
    seen = set()
    for topic in candidates:
        value = re.sub(r'^[\s:–—-]+|[\s.,;:!?–—-]+$', '', topic or '').strip()
        value = re.sub(r"['\"“”`]", '', value).strip()
        value = re.sub(r'\s+(?:for example|such as|including|that includes|etc\.?|and so on)\b.*$', '', value, flags=re.I)
        key = ' '.join(value.split()).casefold()
        if (len(value) < 3 or len(value) > 80 or not re.search(r'[a-zA-Z]', value)
                or re.match(r'^(?:no specific|not applicable|nothing|a description|an explanation|the answer|the candidate)\b', value, re.I)
                or re.search(r'\b(?:unrelated|irrelevant|gibberish|random token|single token|the question|the response|the answer|was provided|consisted of)\b', value, re.I)
                or re.search(r'\b(?:is|are|was|were|contains|consists|consisted)\s+(?:not|no|unrelated|irrelevant|a|an)\b', value, re.I)
                or key in seen):
            continue
        seen.add(key)
        result.append(value)
        if len(result) == 3:
            break
    return result


def question(setup, index, effective_level=None):
    level = effective_level or setup.level
    if setup.practiceTopic:
        try:
            matches = [item for item in load_bank() if setup.role in item.roles
                       and level in item.levels and setup.type == item.type
                       and (item.topic.casefold() in setup.practiceTopic.casefold()
                            or setup.practiceTopic.casefold() in item.topic.casefold())]
        except BankError:
            matches = []
        if matches:
            item = sorted(matches, key=lambda candidate: candidate.id)[index % len(matches)]
            return item.candidate_prompt(setup.role)
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
        return (f'Question {index + 1} ({level}): {prompts[index % len(prompts)]} '
                f'Implement in {language} and explain time and space complexity.')
    prompts = (['Tell me about a difficult problem you solved.', 'Describe a disagreement with a teammate.',
                'How did you respond to critical feedback?'] if setup.type == 'Behavioral' else
               [f'Describe a core concept you use as a {setup.role}.', 'How would you investigate a production issue?',
                'What trade-offs would you consider when designing a reliable system?'])
    fallback = f'Question {index + 1} ({level}): {prompts[index % len(prompts)]}'
    if setup.practiceTopic and index == 0:
        return (f'No matching curated questions for “{setup.practiceTopic}”. '
                f'Continuing with a role-compatible {setup.type.lower()} practice question.\n\n{fallback}')
    return fallback


def report(interview, evaluations=None):
    evaluations = evaluations or {}
    answers = [m for m in interview.messages if m.sender == 'you']
    questions = [m for m in interview.messages if m.sender == 'ai']
    evaluated = [evaluations[a.id] for a in answers if evaluations.get(a.id) is not None]
    category_values = {
        name: [value for evaluation in evaluated if (value := getattr(evaluation, name)) is not None]
        for name in Scores.model_fields
    }
    category_averages = {
        name: round(sum(values) / len(values), 1) if values else None
        for name, values in category_values.items()
    }
    available_averages = [value for value in category_averages.values() if value is not None]
    scores = Scores(**category_averages) if available_averages else None
    overall = round(sum(available_averages) / len(available_averages), 1) if available_averages else None
    strengths = list(dict.fromkeys(filter(None, (positive_observation(e.went_well) for e in evaluated))))
    feedback = []
    for q, a in zip(questions, answers):
        evaluation = evaluations.get(a.id)
        topics = practice_topics(evaluation.missing, evaluation.practice_topic) if evaluation else []
        answer_scores = [getattr(evaluation, name) for name in Scores.model_fields
                         if evaluation and getattr(evaluation, name) is not None]
        feedback.append(QuestionFeedback(questionId=q.id, answerId=a.id, q=q.text, answer=a.text,
            score=round(sum(answer_scores) / len(answer_scores), 1) if answer_scores else None,
            scores=evaluation.category_scores() if evaluation else None,
            good=positive_observation(evaluation.went_well) if evaluation else 'AI evaluation unavailable for this answer.',
            miss=evaluation.missing if evaluation else 'This answer has not been scored.',
            better=evaluation.stronger_answer if evaluation else 'Try another interview when AI evaluation is available.',
            practiceTopic=topics[0] if topics else None, practiceTopics=topics,
            codingJudge=a.codingJudge))
    answered_main = sum(answer.kind == 'main' for answer in answers)
    return Feedback(interviewId=interview.id, answeredQuestions=answered_main,
        selectedQuestions=interview.setup.questionCount, overall=overall, scores=scores,
        strengths=strengths,
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

    def dashboard_summary(self, user_id):
        records = list(self.session.scalars(select(InterviewRecord).where(
            InterviewRecord.owner_id == user_id, InterviewRecord.status != 'active'
        ).order_by(InterviewRecord.started_at.desc(), InterviewRecord.id)))
        interviews = [Interview.model_validate(record.payload) for record in records]
        completed = {i.id: i for i in interviews if i.status == 'complete'}
        evaluation_rows = list(self.session.scalars(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id.in_([i.id for i in interviews])
        ))) if interviews else []
        evaluations = {}
        for row in evaluation_rows:
            if row.result is not None:
                evaluations[row.answer_id] = (row.interview_id, AnswerEvaluation.model_validate(row.result))

        grouped = {}
        claim_sources = {'strengths': {}, 'weaknesses': {}}
        practice_evidence = {}
        for interview in completed.values():
            setup = interview.setup
            key = (setup.role, setup.type, setup.mode, setup.level)
            group = grouped.setdefault(key, {'sessions': [], 'interviews': [],
                                              'categories': {name: [] for name in Scores.model_fields}})
            group['interviews'].append(interview)
            answer_ids = [m.id for m in interview.messages if m.sender == 'you']
            scored = [(answer_id, evaluations[answer_id][1]) for answer_id in answer_ids
                      if answer_id in evaluations and any(
                          getattr(evaluations[answer_id][1], name) is not None
                          for name in Scores.model_fields)]
            if scored:
                category_scores = {}
                for name in Scores.model_fields:
                    values = [getattr(e, name) for _, e in scored if getattr(e, name) is not None]
                    category_scores[name] = round(sum(values) / len(values), 1) if values else None
                available_averages = [value for value in category_scores.values() if value is not None]
                overall = round(sum(available_averages) / len(available_averages), 1)
                group['sessions'].append((interview, overall))
                for name, value in category_scores.items():
                    if value is not None:
                        group['categories'][name].append(value)

        # Partial ended sessions can contribute grounded observations, but never score trends.
        for interview in interviews:
            for answer in (m for m in interview.messages if m.sender == 'you'):
                entry = evaluations.get(answer.id)
                if entry is None:
                    continue
                _, evaluation = entry
                if interview.status == 'complete' and any(
                    getattr(evaluation, name) is not None for name in Scores.model_fields
                ):
                    for topic in practice_topics(evaluation.missing, evaluation.practice_topic):
                        normalized = ' '.join(topic.split()).casefold()
                        context = (interview.setup.role, interview.setup.type, interview.setup.level)
                        item = practice_evidence.setdefault((normalized, context),
                                                            {'topic': topic, 'interviews': {}})
                        item['interviews'].setdefault(interview.id, []).append(
                            EvidenceReference(interviewId=interview.id, answerId=answer.id))
                for field, label in (('went_well', 'strengths'), ('missing', 'weaknesses')):
                    text = getattr(evaluation, field).strip()
                    if field == 'went_well':
                        text = positive_observation(text)
                        if not text:
                            continue
                    claim_sources[label].setdefault(text, []).append(
                        EvidenceReference(interviewId=interview.id, answerId=answer.id))

        groups = []
        for (role, interview_type, mode, level), values in sorted(grouped.items()):
            sessions = sorted(values['sessions'], key=lambda item: (item[0].startedAt, item[0].id))
            trends = [DashboardTrend(interviewId=i.id, date=i.startedAt, overall=score)
                      for i, score in sessions]
            scored_count = len(sessions)
            groups.append(DashboardGroup(
                role=role, type=interview_type, mode=mode, level=level, scoredCount=scored_count,
                latestInterviewId=max(values['interviews'], key=lambda item: (item.startedAt, item.id)).id,
                overall=round(sum(score for _, score in sessions) / scored_count, 1) if scored_count else None,
                scores={name: round(sum(vals) / len(vals), 1) if vals else None
                        for name, vals in values['categories'].items()}, trends=trends))

        def common_claims(kind):
            # Model wording can vary in whitespace or capitalization. Group those variants
            # together while keeping the first grounded wording for display.
            grouped_claims = {}
            for text, sources in claim_sources[kind].items():
                normalized = ' '.join(text.split()).casefold()
                if not normalized:
                    continue
                if normalized not in grouped_claims:
                    grouped_claims[normalized] = [text.strip(), []]
                grouped_claims[normalized][1].extend(sources)
            ranked = sorted(grouped_claims.values(), key=lambda item: (-len(item[1]), item[0].casefold()))
            return [EvidenceClaim(text=text, sources=sources) for text, sources in ranked[:3]]

        weaknesses = common_claims('weaknesses')
        suggestions = []
        for item in practice_evidence.values():
            if len(item['interviews']) < 2:
                continue
            topic = item['topic']
            source_interviews = [completed[ident] for ident in item['interviews']]
            latest = max(source_interviews, key=lambda interview: (interview.startedAt, interview.id))
            setup = latest.setup.model_copy(update={'mode': 'Practice', 'practiceTopic': topic})
            sources = [source for refs in item['interviews'].values() for source in refs]
            suggestions.append({'topic': topic, 'setup': setup, 'sources': sources})
        suggestions.sort(key=lambda suggestion: (-len({source.interviewId for source in suggestion['sources']}),
                                                   suggestion['topic'].casefold()))
        return DashboardSummary(completedCount=len(completed), recentActivity=interviews[:10], groups=groups,
            strengths=common_claims('strengths'), weaknesses=weaknesses,
            suggestions=suggestions[:3])

    def start(self, user_id, setup, first_question=None):
        ident = str(uuid4())
        interview = Interview(id=ident, setup=setup, effectiveLevel=setup.level, startedAt=now(),
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

    def accepted_answer(self, interview_id, question_id):
        record = self.session.scalar(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview_id,
            AnswerEvaluationRecord.question_id == question_id))
        if record is None:
            return None
        return record.answer_id

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

    def answer(self, interview, text, next_question=None, evaluation=None, follow_up_parent_id=None,
               coding_judge=None):
        if interview.status != 'active':
            raise HTTPException(409, 'This interview has ended.')
        question_message = next(m for m in reversed(interview.messages) if m.sender == 'ai')
        main_question_id = question_message.mainQuestionId or question_message.id
        is_main_answer = question_message.kind == 'main'
        answer_message = message(interview.id, 'you', answer_text(interview.setup, text),
            kind=question_message.kind, main_question_id=main_question_id if not is_main_answer else None)
        answer_message.codingJudge = CodingJudgeSummary.model_validate(coding_judge) if coding_judge else None
        interview.messages.append(answer_message)
        self.session.add(AnswerEvaluationRecord(answer_id=answer_message.id,
            interview_id=interview.id, question_id=question_message.id,
            result=evaluation.model_dump(mode='json') if evaluation else None))
        if is_main_answer:
            interview.answeredCount += 1
        current_level = interview.effectiveLevel or interview.setup.level
        if is_main_answer and not any(item.questionId == main_question_id for item in interview.difficultyDecisions):
            effective_level, average, reason = difficulty_transition(current_level, evaluation)
            interview.effectiveLevel = effective_level
            interview.difficultyDecisions.append(DifficultyDecision(
                questionId=main_question_id, answerId=answer_message.id,
                previousLevel=current_level, effectiveLevel=effective_level,
                average=average, reason=reason))
        interview.lastFeedback = evaluation.category_scores() if evaluation and interview.setup.mode == 'Practice' else None
        interview.lastAnswerFeedback = evaluation if interview.setup.mode == 'Practice' else None
        interview.lastCodingJudge = answer_message.codingJudge if interview.setup.mode == 'Practice' else None
        if follow_up_parent_id:
            interview.messages.append(message(interview.id, 'ai', next_question, kind='follow-up',
                main_question_id=follow_up_parent_id))
        elif interview.answeredCount >= interview.setup.questionCount:
            interview.status = 'complete'
            interview.endedAt = now()
        else:
            interview.messages.append(message(interview.id, 'ai', next_question or question(
                interview.setup, interview.answeredCount, interview.effectiveLevel)))
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
