"""Guard release checks and deterministic browser failure diagnostics."""
from pathlib import Path

import yaml


def test_ci_and_manual_production_promotion_workflows():
    root = Path(__file__).resolve().parents[2]
    ecr_template = (root / 'infrastructure/ecr-template.yaml').read_text()
    assert '"countNumber": 10' in ecr_template
    assert 'Keep only the ten most recent tagged application images' in ecr_template
    workflow = yaml.load((root / '.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
    assert 'pull_request' in workflow['on']
    assert workflow['on']['push']['branches'] == ['dev', 'main']
    assert workflow['permissions'] == {'contents': 'read'}
    jobs = workflow['jobs']
    assert set(jobs) == {'backend', 'frontend', 'compose', 'journeys', 'build-image', 'deploy-dev'}
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

    assert not any('aws-actions/' in str(jobs[name]) or 'aws ssm' in str(jobs[name])
                   for name in ('backend', 'frontend', 'compose', 'journeys'))

    build_image = jobs['build-image']
    assert build_image['if'] == "github.event_name == 'push'"
    assert build_image['needs'] == ['backend', 'frontend', 'compose', 'journeys']
    assert build_image['permissions'] == {'contents': 'read', 'id-token': 'write'}
    build_steps = build_image['steps']
    build_commands = [step.get('run', '') for step in build_steps]
    assert any(step.get('uses') == 'aws-actions/amazon-ecr-login@v2' for step in build_steps)
    assert any('date -u +%Y%m%d-%H%M%S' in command and 'GITHUB_SHA:0:7' in command
               and 'docker buildx build' in command and '--push' in command for command in build_commands)
    assert build_image['outputs']['image_uri'] == '${{ steps.publish.outputs.image_uri }}'

    deploy_dev = jobs['deploy-dev']
    assert deploy_dev['if'] == "github.event_name == 'push' && github.ref == 'refs/heads/dev'"
    assert deploy_dev['needs'] == ['build-image']
    dev_commands = [step.get('run', '') for step in deploy_dev['steps']]
    assert any('aws ssm send-command' in command and 'docker compose' in command
               and 'pull app' in command and '--no-build' in command for command in dev_commands)
    assert any('--comment "Deploy image to Dev"' in command and '${IMAGE_URI}' not in command
               for command in dev_commands)
    assert any(r'sed -i \"/APP_IMAGE=/d\"' in command
               and r'printf \"APP_IMAGE=%s' in command for command in dev_commands)
    assert not any(r'\\\"' in command for command in dev_commands)
    assert not any('docker build' in command or 'docker buildx' in command for command in dev_commands)

    promotion = yaml.load((root / '.github/workflows/promote.yml').read_text(), Loader=yaml.BaseLoader)
    assert 'workflow_dispatch' in promotion['on']
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
    assert any('APP_IMAGE=' in command for command in promote_commands)
    assert any('docker compose --env-file' in command and 'pull app' in command
               and '--no-build' in command for command in promote_commands)
    assert any('"Promote Dev image to Production"' in command
               for command in promote_commands)
    assert any(r'sed -i \"/APP_IMAGE=/d\"' in command
               and r'printf \"APP_IMAGE=%s' in command for command in promote_commands)
    assert not any(r'\\\"' in command for command in promote_commands)
    assert not any('docker build ' in command or ' up -d --build ' in command
                   for command in promote_commands)
    assert any("OutputKey=='ApplicationUrl'" in command and 'api/health' in command
               for command in promote_commands)
