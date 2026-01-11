#!/bin/bash
set -e

echo "Initializing LocalStack resources..."

# Create S3 buckets for file storage
awslocal s3 mb s3://podex-files
awslocal s3 mb s3://podex-workspaces

# Create DynamoDB tables
awslocal dynamodb create-table \
    --table-name podex-sessions-dev \
    --attribute-definitions \
        AttributeName=PK,AttributeType=S \
        AttributeName=SK,AttributeType=S \
        AttributeName=GSI1PK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
        AttributeName=PK,KeyType=HASH \
        AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
        "[{\"IndexName\":\"GSI1\",\"KeySchema\":[{\"AttributeName\":\"GSI1PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI1SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}]" \
    --billing-mode PAY_PER_REQUEST

# Create Secrets Manager secrets (matching AWS production secrets structure)
# Database credentials
awslocal secretsmanager create-secret \
    --name podex/dev/database \
    --secret-string '{"username":"dev","password":"devpass"}'

# JWT secret for authentication
awslocal secretsmanager create-secret \
    --name podex/dev/jwt-secret \
    --secret-string 'dev-jwt-secret-key-change-in-production-64chars-minimum-required'

# Internal API key for inter-service communication
awslocal secretsmanager create-secret \
    --name podex/dev/internal-api-key \
    --secret-string 'dev-internal-api-key-for-local-development'

# Sentry DSN configuration (placeholder for local dev)
awslocal secretsmanager create-secret \
    --name podex/dev/sentry \
    --secret-string '{"dsn":"","frontend_dsn":""}'

# Redis AUTH token (not used in local docker Redis, but created for compatibility)
awslocal secretsmanager create-secret \
    --name podex/dev/redis-auth \
    --secret-string 'local-redis-auth-token-not-used-in-development'

# ============================================================
# COGNITO SETUP (LocalStack Pro feature - optional)
# ============================================================

echo "Attempting Cognito User Pool setup..."

# Check if Cognito is available (Pro feature)
COGNITO_AVAILABLE=true
USER_POOL_ID=""
CLIENT_ID=""

# Try to create User Pool - will fail on LocalStack free tier
USER_POOL_ID=$(awslocal cognito-idp create-user-pool \
    --pool-name "podex-users-dev" \
    --policies '{"PasswordPolicy":{"MinimumLength":12,"RequireLowercase":true,"RequireUppercase":true,"RequireNumbers":true,"RequireSymbols":false}}' \
    --auto-verified-attributes email \
    --username-attributes email \
    --query 'UserPool.Id' \
    --output text 2>/dev/null) || COGNITO_AVAILABLE=false

if [ "$COGNITO_AVAILABLE" = true ] && [ -n "$USER_POOL_ID" ]; then
    echo "Created User Pool: $USER_POOL_ID"

    # Create User Pool Client
    CLIENT_ID=$(awslocal cognito-idp create-user-pool-client \
        --user-pool-id "$USER_POOL_ID" \
        --client-name "podex-web-dev" \
        --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
        --query 'UserPoolClient.ClientId' \
        --output text)

    echo "Created User Pool Client: $CLIENT_ID"

    # Create Admin Group
    awslocal cognito-idp create-group \
        --group-name "admin" \
        --user-pool-id "$USER_POOL_ID" \
        --description "Platform administrators with full access"

    # Create Regular Users Group
    awslocal cognito-idp create-group \
        --group-name "users" \
        --user-pool-id "$USER_POOL_ID" \
        --description "Regular platform users"

    echo "Created Cognito groups: admin, users"

    # ============================================================
    # CREATE PREDEFINED USERS
    # ============================================================

    # Admin User
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@podex.local}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-AdminPassword123!}"

    awslocal cognito-idp admin-create-user \
        --user-pool-id "$USER_POOL_ID" \
        --username "$ADMIN_EMAIL" \
        --user-attributes \
            Name=email,Value="$ADMIN_EMAIL" \
            Name=email_verified,Value=true \
            Name=name,Value="Admin User" \
        --temporary-password "$ADMIN_PASSWORD" \
        --message-action SUPPRESS

    # Set permanent password for admin
    awslocal cognito-idp admin-set-user-password \
        --user-pool-id "$USER_POOL_ID" \
        --username "$ADMIN_EMAIL" \
        --password "$ADMIN_PASSWORD" \
        --permanent

    # Add admin to admin group
    awslocal cognito-idp admin-add-user-to-group \
        --user-pool-id "$USER_POOL_ID" \
        --username "$ADMIN_EMAIL" \
        --group-name admin

    echo "Created admin user: $ADMIN_EMAIL"

    # Test User (non-admin)
    TEST_EMAIL="${TEST_EMAIL:-user@podex.local}"
    TEST_PASSWORD="${TEST_PASSWORD:-UserPassword123!}"

    awslocal cognito-idp admin-create-user \
        --user-pool-id "$USER_POOL_ID" \
        --username "$TEST_EMAIL" \
        --user-attributes \
            Name=email,Value="$TEST_EMAIL" \
            Name=email_verified,Value=true \
            Name=name,Value="Test User" \
        --temporary-password "$TEST_PASSWORD" \
        --message-action SUPPRESS

    # Set permanent password for test user
    awslocal cognito-idp admin-set-user-password \
        --user-pool-id "$USER_POOL_ID" \
        --username "$TEST_EMAIL" \
        --password "$TEST_PASSWORD" \
        --permanent

    # Add test user to users group
    awslocal cognito-idp admin-add-user-to-group \
        --user-pool-id "$USER_POOL_ID" \
        --username "$TEST_EMAIL" \
        --group-name users

    echo "Created test user: $TEST_EMAIL"
else
    echo ""
    echo "WARNING: Cognito is not available (requires LocalStack Pro)"
    echo "Using mock Cognito credentials for local development."
    echo "Authentication will use JWT-based local auth instead."
    echo ""

    # Use mock values for local development
    USER_POOL_ID="local-mock-pool-id"
    CLIENT_ID="local-mock-client-id"
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@podex.local}"
    TEST_EMAIL="${TEST_EMAIL:-user@podex.local}"
fi

# Store Cognito IDs in Secrets Manager for API service (real or mock)
if [ "$COGNITO_AVAILABLE" = "true" ]; then
    MOCK_VALUE="false"
else
    MOCK_VALUE="true"
fi

awslocal secretsmanager create-secret \
    --name podex/dev/cognito \
    --secret-string "{\"user_pool_id\":\"$USER_POOL_ID\",\"client_id\":\"$CLIENT_ID\",\"mock\":$MOCK_VALUE}"

echo ""
echo "============================================================"
echo "LocalStack initialization complete!"
echo "============================================================"
echo ""
if [ "$COGNITO_AVAILABLE" = true ]; then
    echo "Cognito User Pool: $USER_POOL_ID"
    echo "Cognito Client ID: $CLIENT_ID"
    echo ""
    echo "Test Credentials:"
    echo "  Admin: $ADMIN_EMAIL"
    echo "  User:  $TEST_EMAIL"
    echo ""
    echo "(Passwords set via environment variables - check .env or docker-compose.yml)"
else
    echo "Cognito: DISABLED (using local JWT auth)"
    echo "Mock User Pool ID: $USER_POOL_ID"
    echo "Mock Client ID: $CLIENT_ID"
    echo ""
    echo "For local development, use the API's built-in auth endpoints."
fi
echo ""
