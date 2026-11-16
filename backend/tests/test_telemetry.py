import asyncio

import httpx
from app.main import create_app
import app.telemetry as telemetry
from fastapi import FastAPI
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def test_app_telemetry_has_service_environment_and_deployed_version(tmp_path, monkeypatch):
    monkeypatch.setenv("OTEL_SERVICE_NAME", "interview-mirror-api-test")
    monkeypatch.setenv("OTEL_DEPLOYMENT_ENVIRONMENT", "staging")
    monkeypatch.setenv("OTEL_SERVICE_VERSION", "20261116-123456-abcdef0")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    app = create_app(database_url=f"sqlite:///{tmp_path / 'telemetry.db'}")
    resource = app.state.tracer_provider.resource.attributes

    assert resource["service.name"] == "interview-mirror-api-test"
    assert resource["deployment.environment"] == "staging"
    assert resource["service.version"] == "20261116-123456-abcdef0"
    assert app._is_instrumented_by_opentelemetry is True
    app.state.store.engine.dispose()


def test_telemetry_defaults_allow_start_without_collector(tmp_path, monkeypatch):
    monkeypatch.delenv("OTEL_SERVICE_NAME", raising=False)
    monkeypatch.delenv("OTEL_DEPLOYMENT_ENVIRONMENT", raising=False)
    monkeypatch.delenv("OTEL_SERVICE_VERSION", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    app = create_app(database_url=f"sqlite:///{tmp_path / 'telemetry-defaults.db'}")
    resource = app.state.tracer_provider.resource.attributes

    assert resource["service.name"] == "interview-mirror-api"
    assert resource["deployment.environment"] == "development"
    assert resource["service.version"] == "0.1.0"
    app.state.store.engine.dispose()


def test_http_request_span_is_exported_with_resource_attributes(tmp_path, monkeypatch):
    exporter = InMemorySpanExporter()
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
    monkeypatch.setenv("OTEL_SERVICE_VERSION", "image:immutable-tag")
    monkeypatch.setattr(telemetry, "OTLPSpanExporter", lambda: exporter)

    app = FastAPI()

    async def health():
        return {"status": "ok"}

    app.get("/health")(health)
    provider = telemetry.instrument_app(app)

    async def send_request():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/health")

    response = asyncio.run(send_request())
    assert response.status_code == 200
    provider.force_flush()

    spans = exporter.get_finished_spans()
    assert any(span.name == "GET /health" for span in spans)
    assert all(
        span.resource.attributes["service.name"] == "interview-mirror-api"
        and span.resource.attributes["deployment.environment"] == "development"
        and span.resource.attributes["service.version"] == "image:immutable-tag"
        for span in spans
    )
    provider.shutdown()
