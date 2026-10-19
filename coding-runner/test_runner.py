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
    instance = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{instance.server_port}"
    instance.shutdown()
    instance.server_close()
    thread.join(timeout=2)


def call(url, payload, token="t" * 48):
    import httpx
    return httpx.post(
        f"{url}/run",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=2,
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


def test_execution_uses_restricted_disposable_container(http_server):
    with patch.object(server.subprocess, "run") as docker_run:
        docker_run.return_value.stdout = b'{"status":"success","stdout":"ok\\n","stderr":""}'
        docker_run.return_value.stderr = b""
        docker_run.return_value.returncode = 0
        response = call(http_server, {"language": "Python", "code": "print('ok')"})
    assert response.status_code == 200
    assert response.json()["stdout"] == "ok\n"
    command = docker_run.call_args_list[0].args[0]
    for flag in ["--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--memory=256m", "--cpus=0.5", "--pids-limit=32"]:
        assert flag in command
    assert any(arg.startswith("type=bind,src=") and arg.endswith(",readonly") for arg in command)
    assert docker_run.call_args_list[0].kwargs["timeout"] == 9
    assert not list(server.SOURCE_DIR.iterdir())


def test_busy_runner_rejects_without_queueing(http_server, monkeypatch):
    monkeypatch.setattr(server.EXECUTION_SLOTS, "acquire", lambda blocking=False: False)
    response = call(http_server, {"language": "Python", "code": "print(1)"})
    assert response.status_code == 429


@pytest.mark.skipif(os.getenv("CODING_RUNNER_INTEGRATION") != "1", reason="requires the executor image and Docker")
def test_docker_isolation_and_resource_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SOURCE_DIR", tmp_path)
    sentinel = Path(tempfile.gettempdir()) / f"runner-host-secret-{os.getpid()}"
    sentinel.write_text("private host content")
    monkeypatch.setenv("AI_API_KEY", "must-not-enter-container")

    def execute(language, code):
        directory = Path(tempfile.mkdtemp(dir=tmp_path))
        source = directory / "source"
        source.write_text(code)
        source.chmod(0o444)
        try:
            return server.run_container(language, source)
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

        assert execute("Python", "this is not valid python !!!")["status"] == "compile-error"
        assert execute("JavaScript", "const = ;")["status"] == "compile-error"
        assert execute("Python", "raise RuntimeError('failed')")["status"] == "runtime-error"
        assert execute("Python", "while True: pass")["status"] == "timeout"
        assert execute("Python", "while True: print('x' * 1000)")["status"] == "output-limit"
        assert execute("Python", "data = bytearray(1024 * 1024 * 1024)")["status"] == "runtime-error"
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
        assert list(tmp_path.iterdir()) == []
        containers = subprocess.run(
            ["docker", "ps", "-a", "--filter", "name=interview-code-", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert not containers.stdout.strip()
    finally:
        sentinel.unlink(missing_ok=True)
