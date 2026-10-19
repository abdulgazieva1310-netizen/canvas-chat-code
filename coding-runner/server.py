"""Private HTTP gateway that starts disposable, network-disabled code containers."""
import hmac
import json
import os
import re
import subprocess
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

IMAGE = os.getenv("CODING_EXECUTOR_IMAGE", "interview-code-executor:1")
TOKEN = os.getenv("CODING_RUNNER_TOKEN", "")
SOURCE_DIR = Path(os.getenv("CODING_RUNNER_SOURCE_DIR", "/var/lib/interview-code-runner/submissions"))
MAX_SOURCE = 50_000
MAX_RESPONSE = 96 * 1024
EXECUTION_SLOTS = threading.BoundedSemaphore(2)
LANGUAGES = {"Python", "Java", "C++", "JavaScript", "TypeScript"}
LANGUAGE_RE = re.compile(r"^(Python|Java|C\+\+|JavaScript|TypeScript)$")


def result(status, stdout="", stderr=""):
    return {"status": status, "stdout": stdout[:MAX_RESPONSE], "stderr": stderr[:MAX_RESPONSE]}


def cleanup_container(name):
    try:
        subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=2, check=False)
    except (OSError, subprocess.SubprocessError):
        pass


def run_container(language, source, stdin=""):
    name = f"interview-code-{uuid.uuid4().hex}"
    command = [
        "docker", "run", "-i", "--name", name, "--rm", "--network=none",
        "--memory=256m", "--memory-swap=256m", "--cpus=0.5", "--pids-limit=32",
        "--read-only", "--tmpfs", "/work:rw,exec,nosuid,nodev,size=32m,uid=65534,gid=65534,mode=0700",
        "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
        "--user=65534:65534", "--ulimit", "cpu=7:7", "--ulimit", "nproc=32:32",
        "--ulimit", "nofile=64:64", "--ulimit", "fsize=1048576:1048576",
        "--env", "HOME=/work", "--env", "TMPDIR=/work",
        "--mount", f"type=bind,src={source},dst=/submission/source,readonly",
        IMAGE, "python3", "/runner/execute.py", language,
    ]
    try:
        completed = subprocess.run(command, input=json.dumps({"stdin": stdin}).encode(), capture_output=True, timeout=9, check=False)
    except subprocess.TimeoutExpired:
        try:
            subprocess.run(["docker", "kill", name], capture_output=True, timeout=2, check=False)
        except (OSError, subprocess.SubprocessError):
            pass
        return result("timeout", stderr="Execution exceeded the 8 second limit.")
    except (OSError, subprocess.SubprocessError):
        return result("unavailable", stderr="The isolated execution service could not start a container.")
    finally:
        cleanup_container(name)

    if len(completed.stdout) > MAX_RESPONSE or len(completed.stderr) > MAX_RESPONSE:
        return result("output-limit", stderr="Output exceeded the 12 KB limit.")
    try:
        payload = json.loads(completed.stdout)
        status = payload.get("status")
        if status not in {"success", "compile-error", "runtime-error", "timeout", "output-limit"}:
            raise ValueError("invalid execution status")
        return result(status, payload.get("stdout", ""), payload.get("stderr", ""))
    except (json.JSONDecodeError, TypeError, ValueError):
        return result("unavailable", stderr="The isolated execution service failed unexpectedly.")


class Handler(BaseHTTPRequestHandler):
    server_version = "InterviewCodeRunner"

    def log_message(self, _format, *_args):
        # Never log request bodies, source text, credentials, or user output.
        return

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"status": "ok"})
        self.send_json(404, {"message": "Not found."})

    def do_POST(self):
        if self.path != "/run":
            return self.send_json(404, {"message": "Not found."})
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {TOKEN}"
        if not TOKEN or not hmac.compare_digest(supplied, expected):
            return self.send_json(401, {"message": "Unauthorized."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json(400, {"message": "Invalid request size."})
        if length < 1 or length > MAX_SOURCE * 6 + 2048:
            return self.send_json(413, {"message": "Code submission exceeds the 50 KB limit."})
        try:
            request = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self.send_json(400, {"message": "Invalid JSON request."})
        if not isinstance(request, dict) or set(request) - {"language", "code", "stdin"} or not {"language", "code"} <= set(request):
            return self.send_json(400, {"message": "Request must contain language and code, with optional input."})
        language, code = request.get("language"), request.get("code")
        stdin = request.get("stdin", "")
        if not isinstance(language, str) or not LANGUAGE_RE.fullmatch(language) or language not in LANGUAGES:
            return self.send_json(422, {"message": "Unsupported coding language."})
        if not isinstance(code, str) or not code.strip():
            return self.send_json(413, {"message": "Code submission must be non-empty and no larger than 50 KB."})
        try:
            stdin_size = len(stdin.encode("utf-8")) if isinstance(stdin, str) else MAX_SOURCE + 1
        except UnicodeEncodeError:
            return self.send_json(400, {"message": "Input must be valid UTF-8 text."})
        if stdin_size > 4096:
            return self.send_json(413, {"message": "Input exceeds the 4 KB limit."})
        try:
            source_size = len(code.encode("utf-8"))
        except UnicodeEncodeError:
            return self.send_json(400, {"message": "Code submission must be valid UTF-8 text."})
        if source_size > MAX_SOURCE:
            return self.send_json(413, {"message": "Code submission must be non-empty and no larger than 50 KB."})
        if not EXECUTION_SLOTS.acquire(blocking=False):
            return self.send_json(429, {"message": "Runner is busy. Try again shortly."})
        try:
            SOURCE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
            if SOURCE_DIR.is_symlink():
                raise OSError("submission directory must not be a symbolic link")
            SOURCE_DIR.chmod(0o700)
            with tempfile.TemporaryDirectory(dir=SOURCE_DIR) as directory:
                source = Path(directory) / "source"
                source.write_text(code, encoding="utf-8")
                source.chmod(0o444)
                execution = run_container(language, source, stdin)
            self.send_json(200, execution)
        except OSError:
            self.send_json(503, result("unavailable", stderr="The isolated runner could not prepare a temporary submission."))
        finally:
            EXECUTION_SLOTS.release()


def main():
    if len(TOKEN) < 32:
        raise SystemExit("CODING_RUNNER_TOKEN must be at least 32 characters")
    SOURCE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    if SOURCE_DIR.is_symlink():
        raise SystemExit("CODING_RUNNER_SOURCE_DIR must not be a symbolic link")
    SOURCE_DIR.chmod(0o700)
    server = BoundedRunnerServer((os.getenv("CODING_RUNNER_HOST", "127.0.0.1"), int(os.getenv("CODING_RUNNER_PORT", "8090"))), Handler)
    server.daemon_threads = True
    server.serve_forever()


class BoundedRunnerServer(ThreadingHTTPServer):
    request_slots = threading.BoundedSemaphore(8)

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


if __name__ == "__main__":
    main()
