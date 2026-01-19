#!/bin/bash
# Set GCP Secret Manager secrets from local .env
# Run this AFTER pulumi up completes

set -e

PROJECT_ID="proven-center-484709-k4"
ENV="dev"

# Load local .env
source "$(dirname "$0")/../.env"

echo "Setting GCP secrets for project: $PROJECT_ID (env: $ENV)"
echo ""

# Function to update secret version
update_secret() {
    local secret_name="$1"
    local secret_value="$2"

    if [ -z "$secret_value" ]; then
        echo "⚠️  Skipping $secret_name (empty value)"
        return
    fi

    echo "✓ Setting $secret_name"
    echo -n "$secret_value" | gcloud secrets versions add "podex-${secret_name}-${ENV}" \
        --project="$PROJECT_ID" \
        --data-file=- 2>/dev/null || \
        echo "  (secret doesn't exist yet - run pulumi up first)"
}

# Set secrets from local .env
echo "=== Setting secrets from local .env ==="
echo ""

# Sentry DSNs - each service gets its own
# Set SENTRY_DSN_API, SENTRY_DSN_AGENT, etc. in .env or use generic SENTRY_DSN as fallback
update_secret "sentry-dsn-api" "${SENTRY_DSN_API:-$SENTRY_DSN}"
update_secret "sentry-dsn-agent" "${SENTRY_DSN_AGENT:-$SENTRY_DSN}"
update_secret "sentry-dsn-compute" "${SENTRY_DSN_COMPUTE:-$SENTRY_DSN}"
update_secret "sentry-dsn-web" "${NEXT_PUBLIC_SENTRY_DSN:-$SENTRY_DSN}"

# Sentry build-time (for source maps)
update_secret "sentry-auth-token" "${SENTRY_AUTH_TOKEN:-}"
update_secret "sentry-org" "${SENTRY_ORG:-}"
update_secret "sentry-project" "${SENTRY_PROJECT:-}"

# Admin credentials
update_secret "admin-email" "${ADMIN_EMAIL:-admin@podex.dev}"
update_secret "admin-password" "${ADMIN_PASSWORD:-}"

# OAuth - GitHub
update_secret "github-client-id" "${GITHUB_CLIENT_ID:-}"
update_secret "github-client-secret" "${GITHUB_CLIENT_SECRET:-}"
# GitHub redirect URI - set based on your production domain
# Example: https://app.podex.dev/auth/callback/github
update_secret "github-redirect-uri" "${GITHUB_REDIRECT_URI:-}"

# OAuth - Google
update_secret "google-client-id" "${GOOGLE_CLIENT_ID:-}"
update_secret "google-client-secret" "${GOOGLE_CLIENT_SECRET:-}"
# Example: https://app.podex.dev/auth/callback/google
update_secret "google-redirect-uri" "${GOOGLE_REDIRECT_URI:-}"

# Stripe
update_secret "stripe-secret-key" "${STRIPE_SECRET_KEY:-}"
update_secret "stripe-webhook-secret" "${STRIPE_WEBHOOK_SECRET:-}"
update_secret "stripe-publishable-key" "${STRIPE_PUBLISHABLE_KEY:-}"

# VAPID (push notifications)
update_secret "vapid-public-key" "${VAPID_PUBLIC_KEY:-}"
update_secret "vapid-private-key" "${VAPID_PRIVATE_KEY:-}"
update_secret "vapid-email" "${VAPID_EMAIL:-}"

# LLM API keys
update_secret "anthropic-api-key" "${ANTHROPIC_API_KEY:-}"
update_secret "openai-api-key" "${OPENAI_API_KEY:-}"

# Email
update_secret "sendgrid-api-key" "${SENDGRID_API_KEY:-}"

echo ""
echo "=== Done ==="
echo ""
echo "To manually set a secret later:"
echo "  echo -n 'your-value' | gcloud secrets versions add podex-SECRET-NAME-${ENV} --project=$PROJECT_ID --data-file=-"
echo ""
echo "To view current secret value:"
echo "  gcloud secrets versions access latest --secret=podex-SECRET-NAME-${ENV} --project=$PROJECT_ID"
