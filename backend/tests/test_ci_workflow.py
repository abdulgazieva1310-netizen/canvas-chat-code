"""Guard release checks and deterministic browser failure diagnostics."""
from pathlib import Path

import yaml


def test_ci_covers_locked_checks_and_failure_artifacts():
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.load((root / '.github/workflows/checks.yml').read_text(), Loader=yaml.BaseLoader)
    assert 'pull_request' in workflow['on']
    assert workflow['on']['push']['branches'] == ['main']
    assert workflow['permissions'] == {'contents': 'read'}
    jobs = workflow['jobs']
    assert set(jobs) == {'tests', 'journeys'}
    for job in jobs.values():
        assert 0 < int(job['timeout-minutes']) <= 15
        commands = [step.get('run', '') for step in job['steps']]
        assert 'uv sync --locked --project backend' in commands
        assert 'npm ci --prefix frontend' in commands
        assert any(step.get('with', {}).get('cache-dependency-path') == 'frontend/package-lock.json' for step in job['steps'])
        assert any(step.get('with', {}).get('cache-dependency-glob') == 'backend/uv.lock' for step in job['steps'])
    commands = [step.get('run', '') for step in jobs['tests']['steps']]
    for command in ['uv run --locked --project backend pytest backend/tests', 'npm test --prefix frontend', 'npm run build --prefix frontend']:
        assert command in commands
    browser = jobs['journeys']
    assert browser['env'] == {'AI_API_KEY': '', 'EMAIL_ADAPTER': 'local'}
    assert any(step.get('run') == 'uv run --locked --project backend python scripts/journey.py' for step in browser['steps'])
    upload = browser['steps'][-1]
    assert upload['if'] == 'failure()'
    assert all(path in upload['with']['path'] for path in ['test-results/', 'playwright-report/', 'journey-servers.log'])
