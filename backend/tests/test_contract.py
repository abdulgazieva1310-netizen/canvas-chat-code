"""Offline OpenAPI structure, reference, and example validation."""
from copy import deepcopy
from pathlib import Path

import pytest
import yaml
from jsonschema import RefResolver
from openapi_schema_validator import OAS30Validator
from openapi_spec_validator import OpenAPIV30SpecValidator

SPEC = yaml.safe_load((Path(__file__).resolve().parents[2] / 'openapi.yaml').read_text())


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def validator(name):
    return OAS30Validator(SPEC['components']['schemas'][name], resolver=RefResolver.from_schema(SPEC))


def test_openapi_is_valid_and_references_are_local(monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError('Contract validation must stay offline')
    monkeypatch.setattr('socket.socket.connect', no_network)
    for node in nodes(SPEC):
        if '$ref' in node:
            assert node['$ref'].startswith('#/'), node['$ref']
    OpenAPIV30SpecValidator(SPEC).validate()


@pytest.mark.parametrize('name', list(SPEC['components']['examples']))
def test_examples_match_their_schemas(name):
    example = SPEC['components']['examples'][name]
    validator(example['x-schema']).validate(example['value'])


def test_nullable_and_inapplicable_scores_are_valid_but_out_of_range_scores_fail():
    validator('NullableScores').validate(None)
    validator('NullableAnswerEvaluation').validate(None)
    validator('PlannedScores').validate(dict(accuracy=None, completeness=8, clarity=7, structure=None))
    assert list(validator('Scores').iter_errors(dict(accuracy=11, completeness=8, clarity=7, structure=6)))
    example = deepcopy(SPEC['components']['examples']['EarlyEndedReport']['value'])
    example['interview']['status'] = 'finished'
    assert list(validator('InterviewReport').iter_errors(example))


def test_planned_contracts_are_distinguished_and_pagination_is_bounded():
    assert SPEC['paths']['/dashboard/summary']['get']['x-implementation-status'] == 'implemented'
    assert SPEC['paths']['/interviews']['get']['x-implementation-status'] == 'implemented'
    validator('HistoryPage').validate(dict(items=[], total=0, page=1, pageSize=20))
    for invalid in ({'page': 0}, {'pageSize': 101}, {'minScore': 0}, {'type': 'Unknown'}):
        assert list(validator('HistoryQuery').iter_errors(invalid))
    validator('DashboardSummary').validate(dict(completedCount=0, recentActivity=[], groups=[],
                                              strengths=[], weaknesses=[], suggestions=[]))
    topic = SPEC['components']['schemas']['InterviewSetup']['properties']['practiceTopic']
    assert topic['maxLength'] == 120 and topic['nullable'] is True
