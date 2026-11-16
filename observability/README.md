# Interview Mirror observability stack

This directory is a standalone Docker Compose project for the OpenTelemetry
Collector, Prometheus, Loki, Tempo, and Grafana. It has its own Compose project
name and persistent named volumes. The application Compose project remains
independent.

## Deploy to Dev and connect Production

Run **Deploy Observability Stack** from GitHub Actions with `dev` selected after
the deployment workflow and infrastructure files have been pushed to that
branch. It resolves the current Dev and Production instances, creates or
updates a small CloudFormation stack that allows OTLP/HTTP (TCP 4318) into the
Dev security group only from those two instance security groups, starts this
Compose project on the existing Dev host, and configures the Dev app to export
to the Dev host's private address. It checks that the current Production image
contains `app.telemetry` before changing its runtime configuration. If it does
not, the workflow reports that Production must first be promoted through the
protected **Promote Dev to Production** workflow. After that reviewer-approved
promotion, run **Deploy Observability Stack** again to connect Production. The
workflow does not bypass the production approval.

The stack does not add an EC2 instance. Collector OTLP/HTTP is the only
observability port published on the Dev host, and the security-group rules
restrict it to Dev and Production. Grafana and Prometheus bind to loopback;
Loki, Tempo, and internal Collector endpoints are not host-published. Docker's
`unless-stopped` restart policy starts the services after reboot. Named volumes
preserve Prometheus, Loki, Tempo, and Grafana data when containers are replaced.
The services have individual memory and swap ceilings sized for the existing
small Dev host; initial startup and queries can be slow under memory pressure.

The workflow role needs permission to inspect the Dev and Production
CloudFormation stacks and instances, create/update the
`interview-mirror-observability-network` stack, and send/poll Systems Manager
commands for both app instances.

## Open Grafana

Grafana is available only on the Dev host's loopback interface. Use an SSM
port-forward session:

```sh
aws ssm start-session \
  --target <DEV_INSTANCE_ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}' \
  --region eu-central-1
```

Then open <http://127.0.0.1:3000>. The generated Grafana admin password is in
`/opt/interview-mirror/observability.env` on the Dev host; retrieve it through
Session Manager. The provisioned dashboard includes the business metrics,
Environment and deployed Version selectors, and a combined Stat panel.

Two provisioned rules appear in the **Interview Mirror** folder: a warning
when at least 20 interviews start in five minutes and fewer than 95% complete,
and a critical alert when at least five start with no completions in that
window. Either condition must persist for five minutes. Each alert instance
retains its `environment` and `version` labels and includes the service,
maintainer owner, and dashboard link. These counters identify a completion
shortfall; they do not distinguish a failed report from an interview that is
still in progress. Check recent application errors and report generation for
the matching environment and image tag. The rules are visible in Grafana
Alerting, but no email, chat, or paging destination is configured.

The protected promotion workflow installs
`observability/application-otel.compose.yaml` outside the Production checkout
and applies it to the app Compose project. This lets a Production host whose
checkout remains on `main` receive the OpenTelemetry environment values while
still running the independently promoted ECR image.

## Local use

Start the standalone stack from the repository root:

```sh
docker compose -f observability/compose.yaml up -d
```

All host ports bind to `127.0.0.1` by default. For a backend process running on
the host, configure and start it with:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
uv run --project backend uvicorn app.main:app --reload --port 8000
```

The Collector accepts OTLP over gRPC and HTTP inside its Compose network; only
HTTP is published to the host. It sends traces to Tempo, exposes received
application metrics for Prometheus to scrape, and exports logs to Loki.
Prometheus also scrapes its own and the Collector's internal metrics endpoints.

In deployed environments, the app's `OTEL_EXPORTER_OTLP_ENDPOINT` points at the
Dev host's private address. The existing `deployment.environment` and
`service.version` resource attributes remain sourced from each app's runtime
environment and image tag. After replacing the Dev host, re-run the workflow so
it resolves the new private address and reapplies the security-group rules.

To stop the project and preserve data:

```sh
docker compose -f observability/compose.yaml down
```

To delete the stack and its stored metrics, logs, traces, and Grafana state:

```sh
docker compose -f observability/compose.yaml down --volumes
```
