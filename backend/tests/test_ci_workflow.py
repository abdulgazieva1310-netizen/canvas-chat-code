"""Guard release checks and deterministic browser failure diagnostics."""
from pathlib import Path

import yaml


def test_ci_covers_locked_checks_and_failure_artifacts():
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.load((root / '.github/workflows/checks.yml').read_text(), Loader=yaml.BaseLoader)
    assert 'pull_request' in workflow['on']
    assert workflow['on']['push']['branches'] == ['dev', 'main']
    assert workflow['permissions'] == {'contents': 'read'}
    jobs = workflow['jobs']
    assert set(jobs) == {'backend', 'frontend', 'compose', 'deploy', 'journeys'}
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

    deploy = jobs['deploy']
    assert deploy['if'] == "github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main')"
    assert deploy['needs'] == ['backend', 'frontend', 'compose', 'journeys']
    assert deploy['permissions'] == {'contents': 'read', 'id-token': 'write'}
    deploy_steps = deploy['steps']
    credentials = next(step for step in deploy_steps
                       if step.get('uses') == 'aws-actions/configure-aws-credentials@v4')
    assert credentials['with']['role-to-assume'] == '${{ vars.AWS_DEPLOY_ROLE_ARN }}'
    deploy_commands = [step.get('run', '') for step in deploy_steps]
    assert deploy['environment']['name'] == "${{ github.ref == 'refs/heads/main' && 'production' || 'development' }}"
    assert deploy['env']['AWS_STACK_NAME'] == "${{ github.ref == 'refs/heads/main' && 'interview-mirror-production' || 'interview-mirror-staging' }}"
    assert deploy['env']['DEPLOY_BRANCH'] == '${{ github.ref_name }}'
    assert any(
        'aws ssm send-command' in command
        and 'git fetch --depth=1 origin ${DEPLOY_BRANCH}' in command
        and 'docker compose --env-file /opt/interview-mirror/runtime.env --profile aws up -d --build' in command
        for command in deploy_commands
    )
    assert not any('docker push' in command or 'aws ecr' in command or 'aws ecs' in command
                   for command in deploy_commands)
    health_check = next(command for command in deploy_commands if 'api/health' in command)
    assert "OutputKey=='ApplicationPublicIp'" in health_check
    assert 'https://dev.${application_ip}.nip.io' in health_check
    assert "OutputKey=='ApplicationUrl'" in health_check
