#!/usr/bin/env bash
# Replay the synthetic events at a RUNNING n8n webhook (the deployed workflow),
# to watch it execute node-by-node in the n8n UI. This is the live-stack analog
# of the offline harness (src/dry-run.js). Keep DRY_RUN=true in n8n while testing.
#
# Usage:
#   ./scripts/send-synthetic.sh                       # -> http://localhost:5678/webhook/plg-signal
#   ./scripts/send-synthetic.sh https://n8n.example/webhook/plg-signal
#
# Requires: bash, curl, jq. Sends only the SYNTHETIC events in examples/.

set -euo pipefail
URL="${1:-http://localhost:5678/webhook/plg-signal}"
EVENTS="$(dirname "$0")/../examples/synthetic-events.json"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

count=$(jq '.events | length' "$EVENTS")
echo "Posting $count synthetic events to $URL"
echo "(n8n should be running with DRY_RUN=true; nothing is sent to real users.)"
echo

jq -c '.events[]' "$EVENTS" | while read -r ev; do
  who=$(echo "$ev" | jq -r '.properties.email')
  name=$(echo "$ev" | jq -r '.event')
  resp=$(curl -s -X POST "$URL" -H 'Content-Type: application/json' -d "$ev" || echo '{"error":"request failed"}')
  echo "→ $name for $who"
  echo "   $resp"
done

echo
echo "Done. Review executions in the n8n UI (Executions tab)."
