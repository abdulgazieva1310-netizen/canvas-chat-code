# Coding runner security design

## Architecture and boundary review

The API authenticates the account, checks that the interview belongs to it and is active, and permits execution only for technical coding roles and five fixed runtimes. The API sends only the selected language and source through a private authenticated connection. It does not mount or execute code locally. The answer-submission endpoint remains the independent static AI review path.

Run `coding-runner/server.py` on a dedicated runner host with no application database, AI, email, or session credentials. It accepts only the API's runner-specific bearer token, limits requests to 50 KB, allows two concurrent executions, avoids logging request or result bodies, and removes each temporary source directory after execution. Restrict the gateway to the API network and terminate TLS between hosts. Keep the token in the API and runner secret stores; never put it in the frontend or executor image.

The gateway starts one disposable executor container per request. The container receives a single read-only source file and a private writable temporary filesystem. It has no host mounts, Docker socket, application environment, database, or network. It runs as UID 65534 with a read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, Docker's default seccomp profile, cgroup CPU and memory quotas, a PID limit, file-size and descriptor limits, an 8-second wall-clock deadline, a 12 KB output limit, and a 50 KB source limit. The container is force-removed after every outcome. The only supported runtimes are Python, Java, C++, JavaScript, and TypeScript.

## Threat model

| Threat | Control | Verification |
| --- | --- | --- |
| Infinite loops or fork bombs | Wall-clock deadline, CPU quota, PID limit, process limits, forced container removal | Docker integration tests |
| Memory or disk exhaustion | 256 MB memory limit, 32 MB temporary filesystem, 1 MB file-size limit | Docker integration tests |
| Excessive output | Bounded harness reads and a 12 KB response cap | Docker integration tests |
| Host-file or cross-user access | Dedicated runner host; only the source file is mounted read-only; no shared persistent workspace | Host sentinel test and container configuration test |
| Network exfiltration or scanning | `--network=none`; no proxy or DNS configuration in the executor | Docker integration test |
| Access to app secrets | Separate runner deployment; no app environment or credentials in executor; runner token is not passed into containers | Environment isolation test and deployment review |
| Request abuse | Bearer authentication, bounded JSON, runtime allowlist, and two execution slots | Gateway tests |
| Compile/runtime/infrastructure failure | Structured statuses; static AI review remains a separate submit action | API and Docker integration tests |

## Residual risk and deployment gate

Containers share the runner host kernel. A kernel or Docker-daemon escape could compromise that host, so the runner host must be dedicated, patched, have no application secrets or user data, and expose only the private gateway. Do not mount the Docker socket into executor containers. For a threat model requiring a kernel boundary, replace the executor backend with a microVM runtime before public exposure. Promote a built executor image by immutable digest, scan it, and update it through a controlled deployment; the tag in the local Docker test is only a development default.

This gateway provides raw bounded execution only. It does not run question-specific test cases or judge correctness; that remains issue #59. Inputs are not persisted after a request, and execution output is returned only to the authenticated interview owner through the API.
