"""OpenTelemetry setup for the FastAPI application."""

import os

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


DEFAULT_SERVICE_NAME = "interview-mirror-api"
DEFAULT_ENVIRONMENT = "development"
DEFAULT_VERSION = "0.1.0"


def _resource() -> Resource:
    return Resource.create(
        {
            "service.name": os.getenv("OTEL_SERVICE_NAME", DEFAULT_SERVICE_NAME),
            "service.version": os.getenv("OTEL_SERVICE_VERSION", DEFAULT_VERSION),
            "deployment.environment": os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", DEFAULT_ENVIRONMENT),
        }
    )


def _environment_label() -> str:
    value = os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", DEFAULT_ENVIRONMENT).strip().lower()
    return "prod" if value in {"prod", "production"} else "dev"


def _version_label() -> str:
    """Use an image tag as a bounded metric label, preserving local release versions."""
    value = os.getenv("OTEL_SERVICE_VERSION", DEFAULT_VERSION).strip() or DEFAULT_VERSION
    colon = value.rfind(":")
    if colon > value.rfind("/") and colon < len(value) - 1:
        return value[colon + 1:]
    return value


class BusinessMetrics:
    """Low-cardinality business counters exported through the configured OTLP collector."""

    def __init__(self, meter):
        self._attributes = {
            "environment": _environment_label(),
            "version": _version_label(),
        }
        self._interviews_started = meter.create_counter(
            "interviews_started", description="Number of newly created interviews"
        )
        self._interviews_completed = meter.create_counter(
            "interviews_completed", description="Number of completed interviews with a generated report"
        )
        self._study_plans_generated = meter.create_counter(
            "study_plans_generated", description="Number of newly generated study plans"
        )

    def interview_started(self):
        self._interviews_started.add(1, self._attributes)

    def interview_completed(self):
        self._interviews_completed.add(1, self._attributes)

    def study_plan_generated(self):
        self._study_plans_generated.add(1, self._attributes)


def create_business_metrics(metric_reader=None) -> tuple[MeterProvider, BusinessMetrics]:
    """Create business counters; export through OTLP/HTTP only when configured."""
    readers = []
    if metric_reader is not None:
        readers.append(metric_reader)
    elif os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        readers.append(PeriodicExportingMetricReader(OTLPMetricExporter()))
    provider = MeterProvider(resource=_resource(), metric_readers=readers)
    return provider, BusinessMetrics(provider.get_meter("interview-mirror.business"))


def instrument_app(app: FastAPI) -> TracerProvider:
    """Instrument HTTP requests and export spans when an OTLP endpoint is set."""
    resource = _resource()
    provider = TracerProvider(resource=resource)

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint:
        # The OTLP HTTP exporter defaults to /v1/traces when given a base URL.
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))

    FastAPIInstrumentor.instrument_app(
        app, tracer_provider=provider, exclude_spans=["receive", "send"]
    )
    return provider
