import importlib.util
from pathlib import Path


DEPLOYMENT_SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'deployment-smoke.py'
SPEC = importlib.util.spec_from_file_location('deployment_smoke', DEPLOYMENT_SCRIPT)
deployment = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deployment)


def test_port_pair_is_distinct():
    backend_port, frontend_port = deployment.ports()

    assert backend_port != frontend_port
