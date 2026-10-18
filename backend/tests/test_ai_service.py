import json

import httpx
import pytest

from app.services import ai_service
from app.store import message


def mock_provider(monkeypatch, handler):
    client_class = httpx.Client
    monkeypatch.setattr(ai_service.httpx, 'Client', lambda **kwargs: client_class(
        transport=httpx.MockTransport(handler), **kwargs))


@pytest.mark.parametrize('key', [None, '', '   ', 'your_api_key_here'])
def test_missing_key_skips_network(monkeypatch, key):
    if key is not None:
        monkeypatch.setenv('AI_API_KEY', key)
    def unexpected(**kwargs):
        pytest.fail('No API request expected')
    monkeypatch.setattr(ai_service.httpx, 'Client', unexpected)
    assert ai_service.generate_question('Backend Developer', 'Middle', []) is None


def test_provider_receives_context(monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'test-secret')
    monkeypatch.setenv('AI_MODEL', 'test-model')
    def handler(request):
        assert str(request.url) == ai_service.API_URL
        assert request.headers['Authorization'] == 'Bearer test-secret'
        assert request.extensions['timeout']['read'] == 10
        payload = json.loads(request.content)
        assert payload['model'] == 'test-model'
        system = payload['messages'][0]['content']
        for value in ['Backend Developer', 'Senior', 'Behavioral', 'Distributed systems']:
            assert value in system
        assert payload['messages'][1:3] == [
            {'role': 'assistant', 'content': 'Earlier question?'},
            {'role': 'user', 'content': 'My answer'},
        ]
        assert 'Hidden hint' not in json.dumps(payload)
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop',
            'message': {'content': '  How would you handle a network partition?  '}}]})
    mock_provider(monkeypatch, handler)
    history = [message('i', 'ai', 'Earlier question?'), message('i', 'hint', 'Hidden hint'),
               message('i', 'you', 'My answer')]
    assert ai_service.generate_question('Backend Developer', 'Senior', history,
        interview_type='Behavioral', job_description='Distributed systems') == 'How would you handle a network partition?'


@pytest.mark.parametrize('failure', ['timeout', 'unauthorized', 'rate_limit', 'server_error',
    'bad_json', 'no_choices', 'null_choices', 'blank', 'null', 'truncated'])
def test_provider_failures_fall_back(monkeypatch, failure, caplog):
    monkeypatch.setenv('AI_API_KEY', 'test-secret')
    def handler(request):
        if failure == 'timeout':
            raise httpx.ReadTimeout('test-secret must not be logged', request=request)
        if failure in ('unauthorized', 'rate_limit', 'server_error'):
            return httpx.Response({'unauthorized': 401, 'rate_limit': 429, 'server_error': 500}[failure],
                                  text='test-secret')
        if failure == 'bad_json':
            return httpx.Response(200, text='invalid json')
        payload = {'choices': [{'finish_reason': 'stop', 'message': {'content': '   '}}]}
        if failure == 'no_choices':
            payload = {'choices': []}
        elif failure == 'null_choices':
            payload = {'choices': None}
        elif failure == 'null':
            payload['choices'][0]['message']['content'] = None
        elif failure == 'truncated':
            payload['choices'][0]['finish_reason'] = 'length'
        return httpx.Response(200, json=payload)
    mock_provider(monkeypatch, handler)
    assert ai_service.generate_question('Backend Developer', 'Middle', []) is None
    assert 'fallback question' in caplog.text
    assert 'test-secret' not in caplog.text


@pytest.mark.parametrize('status, detail', [
    (401, 'Invalid API Key'),
    (404, 'The model missing-model does not exist'),
    (429, 'Rate limit reached'),
])
def test_http_errors_log_status_provider_detail_and_traceback(monkeypatch, caplog, status, detail):
    monkeypatch.setenv('AI_API_KEY', 'test-secret')
    mock_provider(monkeypatch, lambda request: httpx.Response(status, json={
        'error': {'message': f'{detail}: test-secret'},
    }))
    assert ai_service.generate_question('Backend Developer', 'Middle', []) is None
    assert f'HTTP status: {status}' in caplog.text
    assert detail in caplog.text
    assert 'Groq API Error: HTTPStatusError' in caplog.text
    assert 'Traceback (most recent call last)' in caplog.text
    assert '[REDACTED]' in caplog.text
    assert 'test-secret' not in caplog.text


def test_timeout_logs_exception_without_exposing_key(monkeypatch, caplog):
    monkeypatch.setenv('AI_API_KEY', 'test-secret')
    def timeout(request):
        raise httpx.ReadTimeout('Connection timed out: test-secret', request=request)
    mock_provider(monkeypatch, timeout)
    assert ai_service.generate_question('Backend Developer', 'Middle', []) is None
    assert 'ReadTimeout: Connection timed out: [REDACTED]' in caplog.text
    assert 'HTTP status: no response' in caplog.text
    assert 'Traceback (most recent call last)' in caplog.text
    assert 'test-secret' not in caplog.text


def test_masked_key_is_printed_before_request(monkeypatch, capsys):
    monkeypatch.setenv('AI_API_KEY', 'private-key-1234')
    def handler(request):
        output = capsys.readouterr().out
        assert 'Groq AI_API_KEY=***1234 (length=16)' in output
        assert str(ai_service.ENV_PATH) in output
        assert 'private-key' not in output
        return httpx.Response(401, json={'error': {'message': 'Invalid API Key'}})
    mock_provider(monkeypatch, handler)
    assert ai_service.generate_question('Backend Developer', 'Middle', []) is None


def test_missing_key_diagnostic(monkeypatch, capsys):
    assert ai_service.generate_question('Backend Developer', 'Middle', []) is None
    assert 'Groq AI_API_KEY=None' in capsys.readouterr().out
