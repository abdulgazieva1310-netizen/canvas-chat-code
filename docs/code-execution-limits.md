# Code execution limits and failure reporting — issue #88

This policy describes the isolated runner used for reviewed coding questions.
Each case runs in a new disposable container. The runner executes untrusted
source; it does not run candidate code in the API process. Limits are enforced
both by the harness and the runner gateway where noted.

## Request and concurrency limits

| Resource | Limit | Enforcement |
| --- | ---: | --- |
| Source | 50,000 UTF-8 bytes | Private gateway before creating a source file |
| Standard input | 4,096 UTF-8 bytes per execution | Private gateway |
| Concurrent container executions | 2; no queue | Non-blocking gateway semaphore; excess request gets HTTP 429 |
| Gateway request body | At most `50,000 × 6 + 2,048` bytes | HTTP envelope guard accommodates JSON escaping |
| Gateway response | 96 KiB while draining | Capture loop kills/reaps the gateway child if exceeded |
| Candidate output | 12 KiB combined stdout and stderr | Harness kills process group; gateway independently caps raw and decoded response |
| Judging request | 45 seconds for all reviewed cases | API deadline; expiration is runner unavailability, preserving prior pass count |

## Per-container isolation and limits

| Control | Setting |
| --- | --- |
| Memory and swap | 256 MiB memory, swap limited to the same 256 MiB |
| CPU | 0.5 CPU quota; 7 seconds of CPU time per process |
| Wall time | Harness allows 12 seconds for each compile or run command; gateway kills a container after 16 seconds total |
| Processes | 32 PIDs per container; 32-process ulimit |
| File descriptors | 64 per process |
| File size | 1 MiB per file; core dumps disabled |
| Writable storage | Fresh 32 MiB `/work` tmpfs, executable, `nosuid,nodev`; removed with the container |
| Root filesystem/source | Read-only; submitted source mounted read-only |
| User and privileges | UID/GID 65534, all Linux capabilities dropped, `no-new-privileges` |
| Network | Docker `--network=none`; no outbound or inbound container network |
| Environment/logging | No API/provider credentials passed to executor; request bodies, source and program output are excluded from gateway logs |
| Container lifecycle | Unique name, `--rm`, forced cleanup after success, limit, malformed response or timeout |

Compilation and execution each receive their own 12-second harness deadline,
inside the gateway's 16-second container deadline. The outer API request has a
45-second total judge deadline for multiple cases. Tightening or raising a
limit must account for compiler startup (especially Java/TypeScript), all
reviewed cases in one submission, and the client timeout. Resource changes
require exercising the real executor image, not only mocks.

## Failure and candidate outcome mapping

| Failure point | Runner/gateway result | Candidate-facing judge result |
| --- | --- | --- |
| Compiler rejects source | `compile-error` | `compile-error`, zero cases passed; “The submitted solution could not be compiled.” Compiler text is not exposed |
| Program exits unsuccessfully | `runtime-error` | `runtime-error`; generic stopped-with-runtime-error message |
| Harness command exceeds 12 seconds | `timeout` | `timeout`; execution time limit message |
| Gateway container exceeds 16 seconds | `timeout` | `timeout` if received as a valid result |
| Memory, CPU, process, file or other enforced resource exhausted | `resource-limit` | `resource-limit`; generic resource-limit message |
| Stdout/stderr crosses 12 KiB | `output-limit` from executor, mapped to `resource-limit` by judge | Generic resource-limit message; captured output is bounded |
| Successful stdout differs from expected | `success` from runner; judge counts exact string mismatch | `failed`, with failed-case count and contract/boundary coaching |
| All output matches | `success` for every case | `passed`, all reviewed checks passed |
| Unsupported or unreviewed question/language | No execution | `unavailable`; static AI review remains available |
| Gateway busy (HTTP 429), missing configuration, Docker unavailable, malformed/invalid executor response or gateway HTTP failure | Infrastructure failure | `unavailable`; static AI coaching remains available, never reported as an incorrect solution |
| Total 45-second judge budget expires | Partial results retained | `unavailable`, with completed pass count and a generic budget message |

Compilation failures report zero passed cases even when later cases were not
started. Runtime, timeout and resource failures retain the count completed
before failure. Incorrect output is the only result that says the answer did
not match expected behavior. Diagnostic text, hidden input/output, container
paths and host errors never enter the candidate summary. Static AI feedback is
stored independently and remains available when automated execution is
unavailable.

The candidate can distinguish compiler/runtime errors from correctness
failures and service/resource failures, but does not receive hidden cases or
raw stderr. The public **Run examples** path executes only public fixtures and
returns bounded public output; submission judging uses server-side reviewed
cases. These requests require an active owned coding interview and an exact
reviewed question ID/version/spec identity.

## Validation and operations

The private gateway binds to loopback by default, requires a bearer token, and
rejects excess concurrency instead of queueing work. The systemd service runs
under a dedicated user with a private writable submission directory and
additional systemd restrictions. Operators must deploy the gateway and executor
image together, protect the shared token, monitor Docker capacity and cleanup,
and keep the runner reachable only from the API service/network.

Existing verification includes mocked mapping tests for compile/runtime/
timeout/resource/unavailable outcomes, concurrency rejection, request/output
limits, and Docker integration checks for CPU/memory, PID limits, read-only
filesystems, no network, UID, credentials and disposable-container cleanup.
Run the live executor/resource tests with:

```sh
CODING_RUNNER_INTEGRATION=1 CODING_EXECUTOR_IMAGE=interview-code-executor:issue80 uv run --project backend pytest coding-runner/test_runner.py -q
```

The live integration suite depends on Docker and the exact executor image. A
skipped integration run is not evidence that host/container limits are active.
Changes to these values require updating this file, `coding-runner/server.py`,
`coding-runner/execute.py`, user-facing outcome tests and the deployed image in
the same reviewed change.

Related contracts: [coding judge specs](coding-judge-specs.md); implementation:
`coding-runner/server.py`, `coding-runner/execute.py`, and
`backend/app/routers/interviews.py`.
