"""Isolated full browser journeys with deterministic test-only providers."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('deployment', Path(__file__).with_name('deployment-smoke.py'))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)
ROOT = deployment.ROOT


def main():
    backend_port, frontend_port = deployment.port(), deployment.port()
    origin = f'http://127.0.0.1:{frontend_port}'
    api = f'http://127.0.0.1:{backend_port}/api'
    with tempfile.TemporaryDirectory(prefix='interview-journey-') as folder:
        env = os.environ | dict(DATABASE_URL=f'sqlite:///{folder}/journey.db', AI_API_KEY='',
                                EMAIL_ADAPTER='local', SECURE_COOKIES='false', CORS_ORIGINS=origin,
                                PASSWORD_RESET_URL=origin + '/reset-password', NITRO_PRESET='node-server',
                                VITE_API_BASE_URL=api, JOURNEY_ORIGIN=origin, JOURNEY_API=api)
        subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'frontend', env=env, check=True)
        processes = []
        artifacts = ROOT / 'frontend' / 'test-results'
        artifacts.mkdir(exist_ok=True)
        with open(ROOT / 'frontend' / 'journey-servers.log', 'w+') as log:
            try:
                backend = subprocess.Popen([sys.executable, '-m', 'uvicorn', '--app-dir', 'tests',
                                            'journey_app:app', '--host', '127.0.0.1', '--port', str(backend_port)],
                                           cwd=ROOT / 'backend', env=env, stdout=log, stderr=log)
                processes.append(backend)
                deployment.ready(api + '/health', backend)
                frontend = subprocess.Popen(['node', '.output/server/index.mjs'], cwd=ROOT / 'frontend',
                                            env=env | dict(PORT=str(frontend_port), HOST='127.0.0.1'),
                                            stdout=log, stderr=log)
                processes.append(frontend)
                deployment.ready(origin + '/login', frontend)
                subprocess.run(['npx', 'playwright', 'test', '--config', 'playwright.journey.config.ts'],
                               cwd=ROOT / 'frontend', env=env, check=True)
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()


if __name__ == '__main__':
    main()
