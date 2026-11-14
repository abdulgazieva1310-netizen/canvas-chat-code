"""Guard release checks and deterministic browser failure diagnostics."""
from pathlib import Path

import yaml


def test_ci_and_manual_production_promotion_workflows():
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.load((root / '.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
    assert 'pull_request' in workflow['on']
    assert workflow['on']['push']['branches'] == ['dev', 'main']
    assert workflow['permissions'] == {'contents': 'read'}
    jobs = workflow['jobs']
    assert set(jobs) == {'backend', 'frontend', 'compose', 'journeys'}
    for name in ('backend', 'frontend', 'compose', 'journeys'):
        assert 0 < int(jobs[name]['timeout-minutes']) <= 35
    backend = jobs['backend']
    backend_commands = [step.get('run', '') for step in backend['steps']]
    assert 'uv sync --locked --project backend' in backend_commands
    assert 'uv run --locked --project backend pytest backend/tests' in backend_commands
    assert 'uv run --locked --project backend python -m pytest coding-runner/test_runner.py' in backend_commands
    assert any(step.get('with', {}).get('cache-dependency-glob') == 'backend/uv.lock'
               for step in backend['steps'])

    frontend = jobs['frontend']
    frontend_commands = [step.get('run', '') for step in frontend['steps']]
    assert 'npm ci --prefix frontend' in frontend_commands
    assert 'npm test --prefix frontend' in frontend_commands
    assert 'npm run build --prefix frontend' in frontend_commands
    assert any(step.get('with', {}).get('cache-dependency-path') == 'frontend/package-lock.json'
               for step in frontend['steps'])

    compose = jobs['compose']
    compose_commands = [step.get('run', '') for step in compose['steps']]
    assert 'docker compose up --build --detach' in compose_commands
    assert 'uv run --locked --project backend pytest backend/tests/integration/test_compose_stack.py -q' in compose_commands
    assert 'npm run test:e2e:compose --prefix frontend' in compose_commands
    assert 'docker compose down --volumes --remove-orphans' in compose_commands

    browser = jobs['journeys']
    assert browser['env'] == {'AI_API_KEY': '', 'EMAIL_ADAPTER': 'local'}
    assert any(step.get('run') == 'uv run --locked --project backend python scripts/journey.py' for step in browser['steps'])
    upload = browser['steps'][-1]
    assert upload['if'] == 'failure()'
    assert all(path in upload['with']['path'] for path in ['test-results/', 'playwright-report/', 'journey-servers.log'])

    assert not any('aws-actions/' in str(job) or 'aws ssm' in str(job) for job in jobs.values())

    promotion = yaml.load((root / '.github/workflows/promote.yml').read_text(), Loader=yaml.BaseLoader)
    assert promotion['on'] == {'workflow_dispatch': None}
    promote = promotion['jobs']['promote']
    assert promote['environment']['name'] == 'production'
    assert promote['permissions'] == {'contents': 'read', 'id-token': 'write'}
    promote_steps = promote['steps']
    credentials = next(step for step in promote_steps
                       if step.get('uses') == 'aws-actions/configure-aws-credentials@v4')
    assert credentials['with']['role-to-assume'] == '${{ vars.AWS_DEPLOY_ROLE_ARN }}'
    assert promote['env']['DEV_STACK_NAME'] == 'interview-mirror-staging'
    assert promote['env']['PRODUCTION_STACK_NAME'] == 'interview-mirror-production'
    promote_commands = [step.get('run', '') for step in promote_steps]
    assert any('git -C /opt/interview-mirror/repo rev-parse HEAD' in command for command in promote_commands)
    assert any('git fetch --depth=1 origin ' in command and 'docker compose --env-file' in command
               for command in promote_commands)
    assert any("OutputKey=='ApplicationUrl'" in command and 'api/health' in command
               for command in promote_commands)
