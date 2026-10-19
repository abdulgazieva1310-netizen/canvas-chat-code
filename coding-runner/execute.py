"""Untrusted source execution harness. Runs only inside the disposable executor image."""
import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import time

MAX_OUTPUT = 12 * 1024
COMMAND_TIMEOUT = 5.5


def run(command):
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    selector = selectors.DefaultSelector()
    buffers = {process.stdout: bytearray(), process.stderr: bytearray()}
    for stream in buffers:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + COMMAND_TIMEOUT
    while selector.get_map() or process.poll() is None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            return "timeout", b"", b"Execution exceeded the command time limit."
        for key, _ in selector.select(min(remaining, 0.1)):
            stream = key.fileobj
            chunk = os.read(stream.fileno(), 4096)
            if not chunk:
                selector.unregister(stream)
                stream.close()
                continue
            buffers[stream].extend(chunk)
            if sum(map(len, buffers.values())) > MAX_OUTPUT:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                selector.close()
                return "output-limit", bytes(buffers[process.stdout][:MAX_OUTPUT]), b"Output exceeded the 12 KB limit."
    selector.close()
    return "success" if process.returncode == 0 else "runtime-error", bytes(buffers[process.stdout]), bytes(buffers[process.stderr])


def main(language):
    source = "/submission/source"
    work = "/work"
    os.makedirs(work, exist_ok=True)
    compile_command = None
    run_command = None
    if language == "Python":
        compile_command = ["python3", "-c", "import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(),sys.argv[1],'exec')", source]
        run_command = ["python3", source]
    elif language == "JavaScript":
        compile_command = ["node", "--check", source]
        run_command = ["node", source]
    elif language == "TypeScript":
        typed_source = f"{work}/source.ts"
        shutil.copyfile(source, typed_source)
        compile_command = ["tsc", "--target", "ES2020", "--module", "commonjs", "--skipLibCheck", "--outDir", work, typed_source]
        run_command = ["node", f"{work}/source.js"]
    elif language == "Java":
        java_source = f"{work}/Solution.java"
        shutil.copyfile(source, java_source)
        compile_command = ["javac", "-J-Djava.io.tmpdir=/work", "-d", work, java_source]
        run_command = ["java", "-Djava.io.tmpdir=/work", "-cp", work, "Solution"]
    elif language == "C++":
        compile_command = ["g++", "-std=c++17", "-O2", "-x", "c++", source, "-o", f"{work}/solution"]
        run_command = [f"{work}/solution"]
    else:
        return {"status": "compile-error", "stdout": "", "stderr": "Unsupported language."}

    if compile_command:
        compile_status, _, compile_stderr = run(compile_command)
        if compile_status != "success":
            return {
                "status": "compile-error" if compile_status == "runtime-error" else compile_status,
                "stdout": "",
                "stderr": compile_stderr.decode("utf-8", "replace")[:MAX_OUTPUT],
            }
    status, stdout, stderr = run(run_command)
    return {
        "status": status,
        "stdout": stdout.decode("utf-8", "replace")[:MAX_OUTPUT],
        "stderr": stderr.decode("utf-8", "replace")[:MAX_OUTPUT],
    }


if __name__ == "__main__":
    result = main(sys.argv[1] if len(sys.argv) == 2 else "")
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
