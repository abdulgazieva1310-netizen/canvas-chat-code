#!/usr/bin/env bash
set -euo pipefail

command_id="$1"
instance_id="$2"
region="$3"

for attempt in $(seq 1 180); do
  status="$(aws ssm get-command-invocation --command-id "$command_id" \
    --instance-id "$instance_id" --region "$region" --query Status --output text 2>/dev/null || true)"
  case "$status" in
    Success)
      aws ssm get-command-invocation --command-id "$command_id" \
        --instance-id "$instance_id" --region "$region" \
        --query StandardOutputContent --output text
      exit 0
      ;;
    Failed|TimedOut|Cancelled|Cancelling)
      aws ssm get-command-invocation --command-id "$command_id" \
        --instance-id "$instance_id" --region "$region" \
        --query '[StandardOutputContent,StandardErrorContent]' --output text || true
      exit 1
      ;;
    Pending|InProgress|Delayed|"") sleep 10 ;;
    *) echo "Unexpected SSM status: $status" >&2; exit 1 ;;
  esac
done

echo "Timed out waiting for SSM command $command_id" >&2
exit 1
