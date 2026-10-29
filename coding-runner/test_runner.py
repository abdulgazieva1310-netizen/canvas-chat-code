import sys
import tempfile
import threading
import os
import subprocess
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import server


@pytest.fixture
def http_server(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "TOKEN", "t" * 48)
    monkeypatch.setattr(server, "SOURCE_DIR", tmp_path)
    instance = server.BoundedRunnerServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{instance.server_port}"
    instance.shutdown()
    instance.server_close()
    thread.join(timeout=2)


def call(url, payload, token="t" * 48, timeout=2):
    import httpx
    return httpx.post(
        f"{url}/run",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )


def test_requires_bearer_and_validates_language_before_execution(http_server):
    denied = call(http_server, {"language": "Python", "code": "print(1)"}, "wrong")
    assert denied.status_code == 401
    unsupported = call(http_server, {"language": "Ruby", "code": "puts 1"})
    assert unsupported.status_code == 422
    assert not list(server.SOURCE_DIR.iterdir())


def test_runner_limits_source_and_rejects_extra_fields(http_server):
    oversized = call(http_server, {"language": "Python", "code": "x" * 50_001})
    assert oversized.status_code in (413, 422)
    malformed = call(http_server, {"language": "Python", "code": "print(1)", "token": "secret"})
    assert malformed.status_code == 400
    oversized_input = call(http_server, {"language": "Python", "code": "print(1)", "stdin": "x" * 4097})
    assert oversized_input.status_code == 413


def test_execution_uses_restricted_disposable_container(http_server):
    with patch.object(server, "capture_container") as capture, patch.object(server, "cleanup_container") as cleanup:
        capture.return_value = subprocess.CompletedProcess([], 0,
            b'{"status":"success","stdout":"ok\\n","stderr":""}', b"")
        response = call(http_server, {"language": "Python", "code": "print('ok')"})
    assert response.status_code == 200
    assert response.json()["stdout"] == "ok\n"
    command = capture.call_args.args[0]
    for flag in ["-i", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--memory=256m", "--cpus=0.5", "--pids-limit=32", "--log-driver=none", "core=0:0", "cpu=7:7"]:
        assert flag in command
    assert any(arg.startswith("type=bind,src=") and arg.endswith(",readonly") for arg in command)
    cleanup.assert_called_once_with(command[command.index("--name") + 1])
    assert not list(server.SOURCE_DIR.iterdir())


def test_busy_runner_rejects_without_queueing(http_server, monkeypatch):
    monkeypatch.setattr(server.EXECUTION_SLOTS, "acquire", lambda blocking=False: False)
    response = call(http_server, {"language": "Python", "code": "print(1)"})
    assert response.status_code == 429


def test_two_concurrent_executions_reject_a_third_without_queueing(http_server, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    release = threading.Event()
    ready = threading.Event()
    lock = threading.Lock()
    active = 0
    def held_execution(*args, **kwargs):
        nonlocal active
        with lock:
            active += 1
            if active == 2:
                ready.set()
        assert release.wait(4)
        return server.result('success')
    monkeypatch.setattr(server, 'run_container', held_execution)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call, http_server, {'language':'Python', 'code':'print(1)'}, timeout=5)
        second = pool.submit(call, http_server, {'language':'Python', 'code':'print(2)'}, timeout=5)
        try:
            assert ready.wait(3)
            assert call(http_server, {'language':'Python', 'code':'print(3)'}).status_code == 429
        finally:
            release.set()
        assert first.result().status_code == second.result().status_code == 200
    assert list(server.SOURCE_DIR.iterdir()) == []


def test_gateway_bounds_output_even_if_executor_harness_is_bypassed():
    with pytest.raises(server.OutputLimitExceeded):
        server.capture_container([sys.executable, '-c',
            "import os\nwhile True: os.write(1, b'x' * 4096)"], b'', timeout=2)


def test_gateway_deadline_also_bounds_a_process_that_does_not_read_stdin():
    with pytest.raises(subprocess.TimeoutExpired):
        server.capture_container([sys.executable, '-c', 'import time; time.sleep(10)'],
                                 b'x' * 100_000, timeout=.2)


@pytest.mark.parametrize('payload', [[], {'status': 'success', 'stdout': None, 'stderr': ''},
    {'status': 'success', 'stdout': '', 'stderr': '', 'private': 'unexpected'}])
def test_invalid_executor_results_are_infrastructure_failures(monkeypatch, tmp_path, payload):
    monkeypatch.setattr(server, 'capture_container', lambda *a, **kw:
        subprocess.CompletedProcess([], 0, __import__('json').dumps(payload).encode(), b''))
    monkeypatch.setattr(server, 'cleanup_container', lambda name: None)
    assert server.run_container('Python', tmp_path / 'source')['status'] == 'unavailable'


def test_gateway_enforces_decoded_output_limit(monkeypatch, tmp_path):
    payload = {'status': 'success', 'stdout': 'x' * (server.MAX_OUTPUT + 1), 'stderr': ''}
    monkeypatch.setattr(server, 'capture_container', lambda *a, **kw:
        subprocess.CompletedProcess([], 0, __import__('json').dumps(payload).encode(), b''))
    monkeypatch.setattr(server, 'cleanup_container', lambda name: None)
    assert server.run_container('Python', tmp_path / 'source')['status'] == 'output-limit'


@pytest.mark.skipif(os.getenv('CODING_RUNNER_INTEGRATION') != '1', reason='requires Docker')
def test_real_api_public_examples_and_hidden_judging(http_server, monkeypatch, tmp_path):
    sys.path.insert(0, str(Path(__file__).parents[1] / 'backend'))
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.models import AnswerEvaluation
    from app.services import ai_service
    monkeypatch.setenv('CODING_RUNNER_URL', http_server)
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 't' * 48)
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *a, **kw: None)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Implement the next algorithm?')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *a, **kw: AnswerEvaluation(
        accuracy=7, completeness=7, clarity=7, structure=7, went_well='Clear explanation.',
        missing='Explain complexity.', stronger_answer='Explain the stack invariant.'))
    solver = """text = input()
stack = []
pairs = {')':'(', ']':'[', '}':'{'}
ok = True
for c in text:
 if c in '([{': stack.append(c)
 elif not stack or stack.pop() != pairs.get(c): ok = False
print(str(ok and not stack).lower())
"""
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "app.db"}')) as client:
        client.post('/api/auth/login', json={'email':'demo@example.com', 'password':'demo-password'})
        interview = client.post('/api/interviews', json={'role':'Backend Developer', 'level':'Junior',
            'mode':'Practice', 'questionCount':5, 'type':'Technical', 'input':'Text', 'language':'English'}).json()
        path = f"/api/interviews/{interview['id']}"
        public = client.post(path + '/run', json={'language':'Python', 'code':solver})
        assert public.status_code == 200 and public.json()['status'] == 'passed'
        assert '2 of 2' in public.json()['stdout']
        assert client.get(path).json() == interview
        submitted = client.post(path + '/messages', json={'text':solver, 'selectedLanguage':'Python',
            'expectedQuestionId':interview['messages'][0]['id']})
        assert submitted.status_code == 200
        assert submitted.json()['lastCodingJudge']['status'] == 'passed'
        assert submitted.json()['lastCodingJudge']['total'] == 5
        assert submitted.json()['lastAnswerFeedback']['accuracy'] == 7
        assert '(a)' not in str(submitted.json()['lastCodingJudge'])
    # Gateway temporary sources are removed; application data belongs only to the API database.
    assert not [entry for entry in server.SOURCE_DIR.iterdir() if entry.is_dir()]


@pytest.mark.skipif(os.getenv("CODING_RUNNER_INTEGRATION") != "1", reason="requires the executor image and Docker")
def test_docker_isolation_and_resource_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SOURCE_DIR", tmp_path)
    own_containers = set()
    capture = server.capture_container
    def track_container(command, *args, **kwargs):
        own_containers.add(command[command.index('--name') + 1])
        return capture(command, *args, **kwargs)
    monkeypatch.setattr(server, 'capture_container', track_container)
    sentinel = Path(tempfile.gettempdir()) / f"runner-host-secret-{os.getpid()}"
    sentinel.write_text("private host content")
    monkeypatch.setenv("AI_API_KEY", "must-not-enter-container")

    def execute(language, code, stdin=""):
        directory = Path(tempfile.mkdtemp(dir=tmp_path))
        source = directory / "source"
        source.write_text(code)
        source.chmod(0o444)
        try:
            return server.run_container(language, source, stdin)
        finally:
            import shutil
            shutil.rmtree(directory, ignore_errors=True)

    try:
        programs = {
            "Python": "print('ok')",
            "JavaScript": "console.log('ok')",
            "TypeScript": "const answer: number = 42; console.log(answer);",
            "Java": "class Solution { public static void main(String[] args) { System.out.println(42); } }",
            "C++": "#include <iostream>\nint main(){ std::cout << 42 << std::endl; }",
        }
        for language, code in programs.items():
            outcome = execute(language, code)
            expected = "ok" if language in {"Python", "JavaScript"} else "42"
            assert outcome["status"] == "success", (language, outcome)
            assert expected in outcome["stdout"], (language, outcome)
        unicode_input = execute('Python', 'import sys; print(len(sys.stdin.read()))', 'я' * 2000)
        assert unicode_input['status'] == 'success' and unicode_input['stdout'] == '2000\n'

        bracket_solver = """text = input()
stack = []
pairs = {')': '(', ']': '[', '}': '{'}
valid = True
for char in text:
    if char in '([{': stack.append(char)
    elif char in pairs:
        if not stack or stack.pop() != pairs[char]: valid = False
    else: valid = False
print(str(valid and not stack).lower())
"""
        for private_input, expected in [("{}[]\n", "true"), ("{[}]\n", "false"),
                                        ("\n", "true"), ("(((())))\n", "true"), ("(a)\n", "false")]:
            outcome = execute("Python", bracket_solver, private_input)
            assert outcome["status"] == "success" and outcome["stdout"] == expected + "\n", outcome

        assert execute("Python", "this is not valid python !!!")["status"] == "compile-error"
        assert execute("JavaScript", "const = ;")["status"] == "compile-error"
        assert execute("Python", "raise RuntimeError('failed')")["status"] == "runtime-error"
        assert execute("Python", "while True: pass")["status"] == "timeout"
        assert execute("Python", "while True: print('x' * 1000)")["status"] == "output-limit"
        assert execute("Python", "import os,signal; os.kill(os.getpid(), signal.SIGKILL)")["status"] == "resource-limit"
        assert execute("Python", "data = bytearray(512 * 1024 * 1024)")["status"] == "resource-limit"
        fs = execute("Python", f"from pathlib import Path; print(Path('{sentinel}').exists())")
        assert fs["status"] == "success" and "False" in fs["stdout"]
        readonly = execute("Python", "from pathlib import Path\ntry: Path('/etc/runner-write-test').write_text('x'); print('writable')\nexcept OSError: print('read-only')")
        assert readonly["status"] == "success" and "read-only" in readonly["stdout"]
        source_mount = execute("Python", "from pathlib import Path\ntry: Path('/submission/source').write_text('x'); print('writable')\nexcept OSError: print('read-only')")
        assert source_mount["status"] == "success" and "read-only" in source_mount["stdout"]
        network = execute("Python", "import socket\ntry: socket.create_connection(('1.1.1.1',53), timeout=1); print('open')\nexcept OSError: print('blocked')")
        assert network["status"] == "success" and "blocked" in network["stdout"]
        pids = execute("Python", "import subprocess,sys\nkids=[]\nfor _ in range(100):\n try: kids.append(subprocess.Popen([sys.executable,'-c','import time; time.sleep(.1)']))\n except OSError: print('limited'); break\nfor kid in kids: kid.wait()")
        assert pids["status"] == "success" and "limited" in pids["stdout"]
        environment = execute("Python", "import os; print('AI_API_KEY' in os.environ)")
        assert environment["status"] == "success" and "False" in environment["stdout"]
        identity = execute("Python", "import os; print(os.getuid()); print(os.geteuid())")
        assert identity['status'] == 'success' and identity['stdout'] == '65534\n65534\n'
        first = execute('Python', "from pathlib import Path; Path('/work/private').write_text('secret')")
        assert first['status'] == 'success'
        second = execute('Python', "from pathlib import Path; print(Path('/work/private').exists())")
        assert second['status'] == 'success' and second['stdout'] == 'False\n'
        disk = execute('Python', "from pathlib import Path\ntry: Path('/work/large').write_bytes(b'x' * (2 * 1024 * 1024))\nexcept OSError: print('limited')")
        assert disk['status'] in {'resource-limit', 'success'}
        if disk['status'] == 'success':
            assert disk['stdout'] == 'limited\n'
        assert list(tmp_path.iterdir()) == []
        containers = subprocess.run(
            ["docker", "ps", "-a", "--filter", "name=interview-code-", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert not own_containers.intersection(containers.stdout.splitlines())
    finally:
        sentinel.unlink(missing_ok=True)
