# On-call alert triage

`poll_alerts.py` polls Grafana's Alertmanager alert-instance API immediately
and then every 60 seconds. Newly firing alert instances are sent as structured
JSON to `codex exec` for read-only triage. Alert labels and annotations are
untrusted input; the prompt explicitly tells the agent not to follow embedded
instructions. Codex runs with `--sandbox read-only` and cannot edit code,
commit, deploy, or remediate the service.

The poller requires a Grafana service-account token with permission to read
alert instances. The token is read from the environment and sent as a bearer
header; it is never included in logs or the agent prompt. A fingerprint is
handed off once while the alert remains active. A successful API response in
which the alert is absent clears its deduplication entry, allowing a later
firing of the same alert to be handed off again. API and agent errors are
reported, and failed handoffs are retried on the next poll.

## Configure and run

```sh
export GRAFANA_URL=http://127.0.0.1:3000
export GRAFANA_SERVICE_ACCOUNT_TOKEN='<service-account-token>'
export ON_CALL_AGENT_WORKDIR="$PWD"
python3 on-call-engineer/poll_alerts.py
```

Useful optional settings:

- `ON_CALL_CODEX_BIN` — Codex executable, default `codex`.
- `ON_CALL_STATE_FILE` — persistent deduplication file; defaults to
  `~/.local/state/interview-mirror-on-call/seen-alerts.json`.
- `ON_CALL_POLL_INTERVAL_SECONDS` — poll interval, default `60`.
- `ON_CALL_API_TIMEOUT_SECONDS` — Grafana request timeout, default `10`.
- `ON_CALL_AGENT_TIMEOUT_SECONDS` — triage timeout, default `300`.
- `ON_CALL_LOG_LEVEL` — logging level, default `INFO`.

Run one poll without starting the loop:

```sh
GRAFANA_URL=http://127.0.0.1:3000 \
GRAFANA_SERVICE_ACCOUNT_TOKEN='<service-account-token>' \
python3 on-call-engineer/poll_alerts.py --once
```

Run the tests with:

```sh
python3 -m unittest discover -s on-call-engineer -p 'test_*.py' -v
```

The script is intended to run under a process supervisor on the on-call host.
It does not configure that supervisor, create Grafana credentials, or send
notifications to a paging destination.
