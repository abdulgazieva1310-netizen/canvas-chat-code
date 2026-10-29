"""Synthetic Russian provider probes with reviewable artifacts and no release auto-approval."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..models import Interview, InterviewSetup, Role
from ..services import ai_service
from ..store import message, report


class ValidationCase(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    role: Role
    interview_type: Literal['Behavioral', 'Role-specific', 'Technical']
    question: str
    answer: str
    coding_language: str | None
    forbidden_fragments: list[str] = Field(default_factory=list)
    human_checks: list[str] = Field(min_length=1)


def load_cases():
    path = Path(__file__).resolve().parents[1] / 'data' / 'russian_validation.v1.json'
    data = json.loads(path.read_text())
    if data['version'] != 1:
        raise ValueError('Unknown Russian validation fixture version')
    cases = [ValidationCase.model_validate(case) for case in data['cases']]
    if not cases or len({case.id for case in cases}) != len(cases):
        raise ValueError('Russian validation cases must have unique IDs')
    return cases


def validate(cases, service=ai_service):
    matrix = service.SUPPORTED_LANGUAGE_MATRIX['Russian']
    result = {
        'schemaVersion': 1, 'language': 'Russian', 'provider': matrix['provider'],
        'model': matrix['model'], 'recognitionLocale': matrix['recognition'],
        'synthesisLocale': matrix['synthesis'],
        'checkedAt': datetime.now(timezone.utc).isoformat(), 'checks': [], 'artifacts': [],
        'releaseApproved': False,
        'releaseBlockers': ['Human semantic review is required.',
                            'Real-device Russian recognition and listening review is required.'],
    }

    def check(case_id, stage, passed, reason):
        result['checks'].append({'case': case_id, 'stage': stage, 'passed': bool(passed), 'reason': reason})

    ready = service.provider_supports_language('Russian')
    check(None, 'provider-matrix', ready,
          'Configured Russian preview and allowlisted provider/model are required.')
    if not ready:
        result['automatedPassed'] = False
        return result

    for case in cases:
        def localized(text):
            return (isinstance(text, str) and service.has_russian_text(text)
                    and not any(part.casefold() in text.casefold() for part in case.forbidden_fragments))

        generated = service.generate_question(case.role, 'Middle', [],
            interview_type=case.interview_type, interview_language='Russian')
        check(case.id, 'generated-question', localized(generated), 'Generated content must be Russian and type-compatible.')
        # Fixed reviewed questions isolate hint/evaluation quality from random question selection.
        followup = service.generate_followup(case.role, 'Middle', case.interview_type,
            case.question, case.answer, interview_language='Russian')
        check(case.id, 'followup', localized(followup), 'Follow-up must remain Russian and on the reference question.')
        hint = service.generate_hint(case.question, [], role=case.role, level='Middle',
            interview_type=case.interview_type, interview_language='Russian')
        check(case.id, 'hint', localized(hint), 'Hint must remain Russian and on the reference problem.')
        options = {'language': case.coding_language} if case.coding_language else {}
        evaluation = service.evaluate_answer(case.question, case.answer, interview_language='Russian', **options)
        localized_evaluation = bool(evaluation and localized(evaluation.missing)
            and (not evaluation.went_well or localized(evaluation.went_well))
            and (not evaluation.practice_topic or localized(evaluation.practice_topic)))
        check(case.id, 'evaluation', localized_evaluation, 'Required coaching must remain Russian with real provider scores.')
        example_ok = bool(evaluation and 'временно недоступен' not in evaluation.stronger_answer
            and not any(part.casefold() in evaluation.stronger_answer.casefold() for part in case.forbidden_fragments)
            and (service.has_russian_code_feedback(evaluation.stronger_answer, case.coding_language)
                 if case.coding_language else localized(evaluation.stronger_answer)))
        check(case.id, 'improved-example', example_ok, 'Release quality requires an actual localized improved example.')
        rendered = None
        if evaluation:
            interview_id = f'validation-{case.id}'
            q = message(interview_id, 'ai', case.question)
            a = message(interview_id, 'you', case.answer)
            interview = Interview(id=interview_id, setup=InterviewSetup(role=case.role, level='Middle',
                type=case.interview_type, mode='Practice', questionCount=5, input='Text', language='Russian'),
                status='incomplete', startedAt=datetime.now(timezone.utc), messages=[q, a], answeredCount=1)
            rendered = report(interview, {a.id: evaluation}).model_dump(mode='json')
        report_ok = bool(rendered and evaluation
            and rendered['questions'][0]['miss'] == evaluation.missing
            and rendered['questions'][0]['better'] == evaluation.stronger_answer
            and rendered['questions'][0]['answer'] == case.answer
            and rendered['questions'][0]['scores'] == evaluation.category_scores().model_dump(mode='json'))
        check(case.id, 'report-rendering', report_ok and localized_evaluation,
              'Report must preserve provider evaluation and reference transcript language.')
        result['artifacts'].append({'case': case.id, 'referenceQuestion': case.question,
            'syntheticAnswer': case.answer, 'generatedQuestion': generated, 'followup': followup,
            'hint': hint, 'evaluation': evaluation.model_dump(mode='json') if evaluation else None,
            'report': rendered, 'humanReviewChecks': case.human_checks})
    result['automatedPassed'] = all(check['passed'] for check in result['checks'])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Explicitly allow calls to the configured Groq provider')
    parser.add_argument('--case', choices=[case.id for case in load_cases()])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.live:
        parser.error('--live is required; these probes use provider quota')
    cases = [case for case in load_cases() if args.case is None or case.id == args.case]
    result = validate(cases)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    passed = sum(check['passed'] for check in result['checks'])
    print(f'{passed}/{len(result["checks"])} automated checks passed. Report: {args.output}')
    print('Release approval remains pending human content and real-device speech review.')
    return 0 if result['automatedPassed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
