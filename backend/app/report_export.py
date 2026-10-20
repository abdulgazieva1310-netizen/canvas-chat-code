"""Read-only Markdown export using public saved report fields only."""
import re


def block(value):
    value = str(value)
    longest = max((len(match) for match in re.findall(r'`+', value)), default=0)
    fence = '`' * max(3, longest + 1)
    return f'{fence}\n{value}\n{fence}'


def markdown_report(interview, feedback):
    setup = interview.setup
    lines = ['# Interview report', '',
        'Scores are approximate AI coaching estimates, not predictions of hiring success.', '',
        f'Status: {interview.status} | Answered: {interview.answeredCount} of {setup.questionCount}',
        f'Started: {interview.startedAt.isoformat()}',
        f'Ended: {interview.endedAt.isoformat() if interview.endedAt else "Not recorded"}',
        f'Role: {setup.role} | Type: {setup.type} | Mode: {setup.mode} | Level: {setup.level}',
        f'Interview language: {setup.language} | Input: {setup.input}', '',
        f'Overall: {feedback.overall if feedback.overall is not None else "Not scored"}', '']
    if setup.jobDescription:
        lines += ['## Job description', block(setup.jobDescription), '']
    lines += ['## Strengths', block('\n'.join(feedback.strengths)),
              '## Weaknesses', block('\n'.join(feedback.gaps)), '']
    if interview.status == 'incomplete':
        lines += ['Partial results: this interview ended early.', '']
    if feedback.scores:
        lines += [f'{name}: {value if value is not None else "Not scored"}'
                  for name, value in feedback.scores.model_dump().items()]
    for index, question in enumerate(feedback.questions, 1):
        lines += ['', f'## Question {index}', block(question.q), '', '### Your answer', block(question.answer),
                  '', f'Score: {question.score if question.score is not None else "Not scored"}',
                  '', '### Strengths', block(question.good), '', '### Improvements', block(question.miss),
                  '', '### Stronger answer', block(question.better)]
    lines += ['', '## Transcript']
    for message in interview.messages:
        lines += ['', f'### {message.sender} — {message.createdAt.isoformat()}', block(message.text)]
    return '\n'.join(lines) + '\n'
