"""Run with backend's uv Python after building frontend for node-server.
All writes and logs live in a temporary directory; providers are deterministic.
"""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def ready(url, process):
    for _ in range(200):
        if process.poll() is not None:
            raise RuntimeError('Server exited before becoming ready')
        try:
            if httpx.get(url, follow_redirects=True).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(.1)
    raise RuntimeError('Server readiness timed out')


def main():
    backend_port, frontend_port = port(), port()
    api = f'http://127.0.0.1:{backend_port}/api'
    origin = f'http://127.0.0.1:{frontend_port}'
    with tempfile.TemporaryDirectory(prefix='deployment-smoke-') as folder:
        env = os.environ | dict(DATABASE_URL=f'sqlite:///{folder}/persistent.db',
                                AI_API_KEY='', EMAIL_ADAPTER='local', SECURE_COOKIES='false',
                                PASSWORD_RESET_URL=origin + '/reset-password', CORS_ORIGINS=origin)
        subprocess.run([sys.executable, '-m', 'app.migrate'], cwd=ROOT / 'backend', env=env, check=True)
        subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'frontend',
                       env=env | dict(NITRO_PRESET='node-server', VITE_API_BASE_URL=api), check=True)
        processes = []
        with open(Path(folder) / 'servers.log', 'w+') as log:
            def backend():
                process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app',
                                            '--host', '127.0.0.1', '--port', str(backend_port)],
                                           cwd=ROOT / 'backend', env=env, stdout=log, stderr=log)
                processes.append(process)
                ready(api + '/health', process)
                return process
            try:
                server = backend()
                frontend = subprocess.Popen(['node', '.output/server/index.mjs'], cwd=ROOT / 'frontend',
                                            env=env | dict(PORT=str(frontend_port), HOST='127.0.0.1'),
                                            stdout=log, stderr=log)
                processes.append(frontend)
                ready(origin + '/login', frontend)
                # Use Chromium from the built frontend origin. Browser requests exercise
                # CORS, session cookies and reloads against a real listening API.
                subprocess.run(['node', str(ROOT / 'scripts/deployment-browser.mjs'), origin, api,
                                str(Path(folder) / 'record.json')], cwd=ROOT / 'frontend', env=env, check=True)
                server.terminate()
                server.wait(timeout=10)
                backend()
                import json
                record = json.loads((Path(folder) / 'record.json').read_text())
                response = httpx.get(api + '/interviews/' + record['id'],
                                     headers={'Authorization': record['authorization']})
                response.raise_for_status()
                assert response.json()['setup']['jobDescription'] == 'Deployment persistence check'
                print('PASS: built frontend, browser CORS/cookie authentication, migrations, restart persistence')
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
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
