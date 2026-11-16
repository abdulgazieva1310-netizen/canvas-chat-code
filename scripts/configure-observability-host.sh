#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/opt/interview-mirror/repo}"
env_file="/opt/interview-mirror/observability.env"
compose_file="$repo_dir/observability/compose.yaml"

if [[ ! -f "$compose_file" ]]; then
  echo "Observability Compose file not found: $compose_file" >&2
  exit 1
fi

touch "$env_file"
chmod 0600 "$env_file"

set_env() {
  local key="$1"
  local value="$2"
  sed -i "/^${key}=/d" "$env_file"
  printf '%s=%s\n' "$key" "$value" >> "$env_file"
}

if ! grep -q '^GRAFANA_ADMIN_PASSWORD=' "$env_file"; then
  set_env GRAFANA_ADMIN_PASSWORD "$(openssl rand -hex 32)"
fi
set_env OTEL_BIND_ADDRESS 0.0.0.0

cd "$repo_dir"
docker compose --env-file "$env_file" \
  -f "$compose_file" up -d --remove-orphans

for attempt in $(seq 1 30); do
  running="$(docker compose --env-file "$env_file" \
    -f "$compose_file" ps --status running --services)"
  running_wrapped=$'\n'"$running"$'\n'
  if [[ "$running_wrapped" == *$'\notel-collector\n'* && \
        "$running_wrapped" == *$'\nprometheus\n'* && \
        "$running_wrapped" == *$'\nloki\n'* && \
        "$running_wrapped" == *$'\ntempo\n'* && \
        "$running_wrapped" == *$'\ngrafana\n'* ]]; then
    exit 0
  fi
  sleep 2
done

docker compose --env-file "$env_file" \
  -f "$compose_file" ps
echo "One or more observability services did not become running" >&2
exit 1
