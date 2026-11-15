#!/bin/sh
cd /opt/jarvis/jarvis-economico || exit 1
exec docker compose \
  -f compose.vps.yaml \
  -f compose.backend.yaml \
  -f compose.worker.yaml \
  -f compose.https.yaml "$@"
