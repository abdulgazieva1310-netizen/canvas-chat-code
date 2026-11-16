from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request

import poll_alerts


def alert(fingerprint: str = "fp-1", state: str = "active") -> dict:
    return {
        "fingerprint": fingerprint,
        "labels": {"alertname": "InterviewFailure", "environment": "dev"},
        "annotations": {"summary": "interview completion shortfall"},
        "status": {"state": state},
        "startsAt": "2026-11-16T12:00:00Z",
        "endsAt": "0001-01-01T00:00:00Z",
    }


class AlertApiTests(unittest.TestCase):
    def test_fetch_uses_grafana_instance_endpoint_and_bearer_token(self) -> None:
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return b'[{"labels":{},"status":{"state":"active"}}]'

        with patch.object(poll_alerts, "urlopen", return_value=Response()) as open_url:
            result = poll_alerts.fetch_alerts("http://grafana/", "secret-token")
        request: Request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, "http://grafana" + poll_alerts.ALERTS_PATH)
        self.assertEqual(request.get_header("Authorization"), "Bearer secret-token")
        self.assertEqual(len(result), 1)

    def test_invalid_response_is_rejected(self) -> None:
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return b'{"alerts":[]}'

        with patch.object(poll_alerts, "urlopen", return_value=Response()):
            with self.assertRaises(poll_alerts.AlertApiError):
                poll_alerts.fetch_alerts("http://grafana", "token")

    def test_alert_without_valid_status_is_rejected(self) -> None:
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return b'[{"labels":{},"status":{}}]'

        with patch.object(poll_alerts, "urlopen", return_value=Response()):
            with self.assertRaises(poll_alerts.AlertApiError):
                poll_alerts.fetch_alerts("http://grafana", "token")


class PollingTests(unittest.TestCase):
    def test_handoff_once_until_recovery_then_handoff_again(self) -> None:
        responses = [[alert()], [alert()], [], [alert()]]
        handoffs: list[dict] = []
        with tempfile.TemporaryDirectory() as temp_dir:
            poller = poll_alerts.AlertPoller(
                fetch=lambda: responses.pop(0),
                handoff=lambda details: handoffs.append(details) or True,
                state_file=Path(temp_dir) / "seen.json",
            )
            for _ in range(4):
                self.assertTrue(poller.poll_once())
        self.assertEqual(len(handoffs), 2)
        self.assertEqual(handoffs[0]["fingerprint"], "fp-1")
        self.assertIn("annotations", handoffs[0])
        self.assertIn("startsAt", handoffs[0])

    def test_failed_handoff_retries_on_next_poll(self) -> None:
        results = [False, True]
        with tempfile.TemporaryDirectory() as temp_dir:
            poller = poll_alerts.AlertPoller(
                fetch=lambda: [alert()],
                handoff=lambda _details: results.pop(0),
                state_file=Path(temp_dir) / "seen.json",
            )
            self.assertFalse(poller.poll_once())
            self.assertTrue(poller.poll_once())
            self.assertTrue(poller.poll_once())
            self.assertEqual(poller_alerts_seen(poller.state_file), {"fp-1"})

    def test_api_failure_does_not_clear_seen_alert_state(self) -> None:
        responses = [[alert()], RuntimeError("offline"), [alert()]]

        def fetch():
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

        handoffs: list[str] = []
        with tempfile.TemporaryDirectory() as temp_dir:
            poller = poll_alerts.AlertPoller(
                fetch=fetch,
                handoff=lambda details: handoffs.append(details["fingerprint"]) or True,
                state_file=Path(temp_dir) / "seen.json",
            )
            self.assertTrue(poller.poll_once())
            self.assertFalse(poller.poll_once())
            self.assertTrue(poller.poll_once())
        self.assertEqual(handoffs, ["fp-1"])

    def test_poll_loop_starts_immediately_then_waits_interval(self) -> None:
        class Poller:
            def __init__(self) -> None:
                self.times: list[float] = []
                self.now = 0.0

            def poll_once(self) -> bool:
                self.times.append(self.now)
                return True

            def monotonic(self) -> float:
                return self.now

            def sleep(self, seconds: float) -> None:
                self.now += seconds

        fake = Poller()
        poll_alerts.run_loop(fake, 60, lambda: len(fake.times) >= 3,
                             monotonic=fake.monotonic, sleep=fake.sleep)
        self.assertEqual(fake.times, [0.0, 60.0, 120.0])


class AgentTests(unittest.TestCase):
    def test_codex_receives_json_and_read_only_sandbox(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            received_file = Path(temp_dir) / "received.json"
            stub = Path(temp_dir) / "stub-agent"
            stub.write_text(
                "#!/usr/bin/env python3\n"
                "import os, sys\n"
                "open(os.environ['STUB_AGENT_INPUT'], 'w').write(sys.stdin.read())\n"
                "print('stub diagnosis')\n",
                encoding="utf-8",
            )
            stub.chmod(0o700)
            def runner(command, **kwargs):
                self.assertEqual(command[1:4], ["exec", "--ephemeral", "--sandbox"])
                self.assertEqual(command[4], "read-only")
                self.assertEqual(command[-1], "-")
                self.assertNotIn("GRAFANA_SERVICE_ACCOUNT_TOKEN", kwargs["env"])
                agent_env = kwargs["env"].copy()
                agent_env["STUB_AGENT_INPUT"] = str(received_file)
                return subprocess.run(command[0:1], input=kwargs["input"], text=True,
                                      capture_output=True, env=agent_env, check=False)

            with patch.dict(os.environ, {"GRAFANA_SERVICE_ACCOUNT_TOKEN": "must-not-reach-agent"}):
                self.assertTrue(
                    poll_alerts.invoke_codex(alert_poll_alert(), str(stub), Path(temp_dir), runner=runner)
                )
            prompt = received_file.read_text(encoding="utf-8")
            self.assertIn("untrusted alert data", prompt)
            self.assertIn('"fingerprint": "fp-1"', prompt)


def poller_alerts_seen(path: Path) -> set[str]:
    return set(json.loads(path.read_text(encoding="utf-8"))["fingerprints"])


def alert_poll_alert() -> dict:
    return poll_alerts.alert_details(alert())


if __name__ == "__main__":
    unittest.main()
