#!/bin/sh
# Initialize GCS buckets for local development

set -e

GCS_HOST="fake-gcs:4443"

echo "Waiting for fake-gcs to be ready..."
until curl -sf http://${GCS_HOST}/storage/v1/b > /dev/null 2>&1; do
  sleep 1
done

echo "Creating GCS bucket: podex-workspaces-dev"
curl -X POST http://${GCS_HOST}/storage/v1/b \
  -H "Content-Type: application/json" \
  -d '{"name":"podex-workspaces-dev"}' \
  > /dev/null 2>&1 || true

echo "GCS initialization complete"
