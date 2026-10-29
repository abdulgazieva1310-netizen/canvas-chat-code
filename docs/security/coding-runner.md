# Coding runner security design

## Architecture and boundary review

The API authenticates the account, checks that the interview belongs to it and is active, and permits execution only for technical coding roles and five fixed runtimes. The API sends only the selected language and source through a private authenticated connection. It does not mount or execute code locally. The answer-submission endpoint remains the independent static AI review path.

The candidate-facing **Run public examples** action checks the archived question
ID, question version, judge key, and judge version against an immutable reviewed
registry. It executes only the public cases for that contract, returns pass/fail
counts, and does not save a submission or output. AI-generated questions,
follow-ups, unknown versions, and unreviewed languages remain static-review-only.
Answer submission runs the full reviewed case set separately and preserves AI
coaching when judging is unavailable. A judge operation has a 45-second provider
budget; exhausting that infrastructure budget produces `unavailable`, not a
candidate failure. Candidate timeouts and resource-limit verdicts stay distinct.

Run `coding-runner/server.py` on a dedicated runner host with no application database, AI, email, or session credentials. It accepts only the API's runner-specific bearer token, limits requests to 50 KB, allows two concurrent executions, avoids logging request or result bodies, and removes each temporary source directory after execution. Restrict the gateway to the API network and terminate TLS between hosts. Keep the token in the API and runner secret stores; never put it in the frontend or executor image.

The gateway starts one disposable executor container per request. The container receives a single read-only source file and a private writable temporary filesystem. It has no host mounts, Docker socket, application environment, database, or network. It runs as UID 65534 with a read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, Docker's default seccomp profile, cgroup CPU and memory quotas, a PID limit, file-size and descriptor limits, a 12-second per-command wall-clock deadline, a 12 KB output limit, and a 50 KB source limit. The gateway has a 16-second hard request deadline. The container is force-removed after every outcome. The only supported runtimes are Python, Java, C++, JavaScript, and TypeScript.

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

The gateway independently drains Docker stdout/stderr with a combined 96 KB
encoded capture cap and a 16-second deadline, including while writing stdin.
It enforces a 12 KB combined decoded-output cap. These host-side bounds still
apply if submitted code bypasses or terminates the inner harness. Invalid
executor schemas and abnormal infrastructure exits produce `unavailable`.
Docker logging and core dumps are disabled for executor containers, so raw
program output and memory snapshots are not retained in daemon logs or core files.

## Retention and deployment

Raw execution inputs, temporary source/workspace files, stdout and stderr are
discarded after each request. The API returns public-example summaries only;
it never stores Run-action code or output. Code explicitly submitted as an
interview answer and its bounded judge summary remain in that owner's transcript
until interview/account deletion, following the existing saved-session policy.
Unsent browser drafts follow the separate 24-hour draft policy. Credentials,
request bodies and execution output are not logged by the gateway.

Build the executor image and run the gateway on the dedicated runner host:

```sh
docker build -t interview-code-executor:1 coding-runner
```

Set `CODING_RUNNER_TOKEN` (at least 32 random characters) and a private
`CODING_RUNNER_SOURCE_DIR` for the gateway; the included systemd unit supplies
the latter. Configure the API's `CODING_RUNNER_URL` and matching token. A missing
gateway disables judging, with static AI review still available. Restart the
services after configuration changes. Test a new executor image before promotion:

```sh
CODING_RUNNER_INTEGRATION=1 uv run --project backend pytest coding-runner/test_runner.py coding-runner/test_judge_references.py
```

## Residual risk and deployment gate

Containers share the runner host kernel. A kernel or Docker-daemon escape could compromise that host, so the runner host must be dedicated, patched, have no application secrets or user data, and expose only the private gateway. Do not mount the Docker socket into executor containers. For a threat model requiring a kernel boundary, replace the executor backend with a microVM runtime before public exposure. Promote a built executor image by immutable digest, scan it, and update it through a controlled deployment; the tag in the local Docker test is only a development default.

Question-specific judging runs only for versioned question-bank entries with reviewed
judge keys. The current reviewed contracts and edge cases are documented in
`docs/coding-judge-specs.md`; all other questions receive static AI review only.
Inputs are not persisted after a request, and execution output is returned only to
the authenticated interview owner through the API.
