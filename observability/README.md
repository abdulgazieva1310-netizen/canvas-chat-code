# Local observability stack

This directory is a separate Docker Compose project. It runs an OpenTelemetry
Collector, Prometheus, Loki, Tempo, and Grafana without changing the application
Compose project's services or lifecycle.

## Start and connect the backend

From the repository root, start the stack:

```sh
docker compose -f observability/compose.yaml up -d
```

The backend's OTLP exporter is already configured. For a backend process running
on the host, set the endpoint before starting it:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
uv run --project backend uvicorn app.main:app --reload --port 8000
```

For a container in the separate application Compose project, put
`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` in the repository
root's `.env` (or the environment file used by the app), start both projects,
then connect the Collector container to the application network with a DNS
alias. Run these commands from the repository root:

```sh
docker compose up -d
docker compose -f observability/compose.yaml up -d
APP_CONTAINER="$(docker compose ps -q app)"
APP_NETWORK="$(docker inspect --format='{{ index .Config.Labels "com.docker.compose.project" }}_default' "$APP_CONTAINER")"
COLLECTOR_CONTAINER="$(docker compose -f observability/compose.yaml ps -q otel-collector)"
docker network connect --alias otel-collector "$APP_NETWORK" "$COLLECTOR_CONTAINER"
```

The projects remain separate; this command only joins their runtime networks.
Reconnect the Collector after recreating either Compose project. Before
stopping either project, disconnect the Collector from the application
network:

```sh
docker network disconnect "$APP_NETWORK" "$COLLECTOR_CONTAINER"
```

Then stop the desired project with its own Compose command.

For example, to stop the observability project, reconnect the variables and
disconnect it from the app network before stopping it:

```sh
APP_CONTAINER="$(docker compose ps -q app)"
APP_NETWORK="$(docker inspect --format='{{ index .Config.Labels "com.docker.compose.project" }}_default' "$APP_CONTAINER")"
COLLECTOR_CONTAINER="$(docker compose -f observability/compose.yaml ps -q otel-collector)"
docker network disconnect "$APP_NETWORK" "$COLLECTOR_CONTAINER"
docker compose -f observability/compose.yaml down
```

To stop the application project instead, use the same network-disconnect
commands, then run `docker compose down` from the repository root. The
observability project remains running.
If using a host gateway instead, Docker Desktop commonly resolves
`host.docker.internal`; on Linux, configure the host-gateway name in the app's
runtime and set `OBSERVABILITY_BIND_ADDRESS=0.0.0.0` for this stack. Restrict
host firewall access to trusted sources. Do not expose unauthenticated OTLP
ports to the public internet.

The Collector receives OTLP over gRPC (`4317`) and HTTP (`4318`), sends traces
to Tempo, exposes received application metrics on `8889` for Prometheus to
scrape, and sends received logs to Loki. Prometheus also scrapes its own and
the Collector's internal metrics endpoints.

## Open the tools

All host ports bind to `127.0.0.1` by default:

- Grafana: <http://127.0.0.1:3000> (default username `admin`; set
  `GRAFANA_ADMIN_PASSWORD` before sharing the host)
- Prometheus: <http://127.0.0.1:9090>
- Collector OTLP/HTTP: <http://127.0.0.1:4318>
- Collector OTLP/gRPC: `127.0.0.1:4317`

Grafana's Prometheus, Loki, and Tempo data sources and the **Interview Mirror
Business Metrics** dashboard are provisioned on startup. The dashboard plots
interviews started, completed interviews with generated reports, and study
plans generated. A combined stat panel shows all three counts for the selected
time range. Its Environment selector filters the `dev` and `prod` metric labels.
Use Grafana Explore to inspect traces and logs.

The dashboard's Version selector uses the `version` metric label. In deployed
Compose environments this is the tag parsed from `OTEL_SERVICE_VERSION`, which
defaults to the full `APP_IMAGE` ECR reference. Local Compose builds show
`local` unless overridden; direct backend runs use the backend release version.
The selector defaults to **All**, so the dashboard remains usable before any
metric samples are available.

To stop the stack and preserve stored telemetry:

```sh
docker compose -f observability/compose.yaml down
```

To delete the stack and its stored metrics, logs, traces, and Grafana state:

```sh
docker compose -f observability/compose.yaml down --volumes
```

