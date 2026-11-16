"""OpenTelemetry setup for the FastAPI application."""

import os

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


DEFAULT_SERVICE_NAME = "interview-mirror-api"
DEFAULT_ENVIRONMENT = "development"
DEFAULT_VERSION = "0.1.0"


def instrument_app(app: FastAPI) -> TracerProvider:
    """Instrument HTTP requests and export spans when an OTLP endpoint is set."""
    service_name = os.getenv("OTEL_SERVICE_NAME", DEFAULT_SERVICE_NAME)
    environment = os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", DEFAULT_ENVIRONMENT)
    version = os.getenv("OTEL_SERVICE_VERSION", DEFAULT_VERSION)
    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": version,
            "deployment.environment": environment,
        }
    )
    provider = TracerProvider(resource=resource)

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint:
        # The OTLP HTTP exporter defaults to /v1/traces when given a base URL.
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))

    FastAPIInstrumentor.instrument_app(
        app, tracer_provider=provider, exclude_spans=["receive", "send"]
    )
    return provider
