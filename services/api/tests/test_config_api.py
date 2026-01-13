"""Comprehensive tests for API service configuration."""

import os
from unittest.mock import patch

import pytest

from src.config import MIN_JWT_SECRET_LENGTH, Settings, get_settings


class TestSettingsDefaults:
    """Tests for default settings values."""

    def test_version_default(self) -> None:
        """Test default version."""
        settings = Settings()
        assert settings.VERSION == "0.1.0"

    def test_environment_default(self) -> None:
        """Test default environment."""
        with patch.dict(os.environ, {"ENVIRONMENT": ""}, clear=False):
            settings = Settings()
            assert settings.ENVIRONMENT == "development"

    def test_port_default(self) -> None:
        """Test default port."""
        settings = Settings()
        assert settings.PORT == 3001

    def test_debug_default(self) -> None:
        """Test default debug mode."""
        settings = Settings()
        assert settings.DEBUG is False

    def test_cors_origins_default(self) -> None:
        """Test default CORS origins."""
        settings = Settings()
        assert settings.CORS_ORIGINS == ["http://localhost:3000"]

    def test_database_url_default(self) -> None:
        """Test default database URL."""
        settings = Settings()
        assert "postgresql+asyncpg" in settings.DATABASE_URL

    def test_redis_url_default(self) -> None:
        """Test default Redis URL."""
        settings = Settings()
        assert settings.REDIS_URL == "redis://localhost:6379"

    def test_aws_region_default(self) -> None:
        """Test default AWS region."""
        settings = Settings()
        assert settings.AWS_REGION == "us-east-1"

    def test_aws_endpoint_default(self) -> None:
        """Test default AWS endpoint."""
        settings = Settings()
        assert settings.AWS_ENDPOINT is None


class TestAuthSettings:
    """Tests for authentication settings."""

    def test_jwt_algorithm_default(self) -> None:
        """Test default JWT algorithm."""
        settings = Settings()
        assert settings.JWT_ALGORITHM == "HS256"

    def test_access_token_expire_minutes_default(self) -> None:
        """Test default access token expiry."""
        settings = Settings()
        assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 30

    def test_refresh_token_expire_days_default(self) -> None:
        """Test default refresh token expiry."""
        settings = Settings()
        assert settings.REFRESH_TOKEN_EXPIRE_DAYS == 7

    def test_oauth_github_defaults(self) -> None:
        """Test GitHub OAuth defaults."""
        settings = Settings()
        assert settings.GITHUB_CLIENT_ID is None
        assert settings.GITHUB_CLIENT_SECRET is None
        assert "localhost" in settings.GITHUB_REDIRECT_URI

    def test_oauth_google_defaults(self) -> None:
        """Test Google OAuth defaults."""
        settings = Settings()
        assert settings.GOOGLE_CLIENT_ID is None
        assert settings.GOOGLE_CLIENT_SECRET is None
        assert "localhost" in settings.GOOGLE_REDIRECT_URI


class TestPasswordSettings:
    """Tests for password requirement settings."""

    def test_password_min_length_default(self) -> None:
        """Test default minimum password length."""
        settings = Settings()
        assert settings.PASSWORD_MIN_LENGTH == 8

    def test_password_max_length_default(self) -> None:
        """Test default maximum password length."""
        settings = Settings()
        assert settings.PASSWORD_MAX_LENGTH == 128

    def test_password_require_complexity_default(self) -> None:
        """Test default password complexity requirement."""
        settings = Settings()
        assert settings.PASSWORD_REQUIRE_COMPLEXITY is True

    def test_password_check_common_default(self) -> None:
        """Test default common password check setting."""
        settings = Settings()
        assert settings.PASSWORD_CHECK_COMMON is True


class TestServiceSettings:
    """Tests for service connection settings."""

    def test_compute_service_url_default(self) -> None:
        """Test default compute service URL."""
        settings = Settings()
        assert settings.COMPUTE_SERVICE_URL == "http://compute:3003"

    def test_agent_service_url_default(self) -> None:
        """Test default agent service URL."""
        settings = Settings()
        assert settings.AGENT_SERVICE_URL == "http://agent:3002"

    def test_agent_task_settings(self) -> None:
        """Test agent task polling settings."""
        settings = Settings()
        assert settings.AGENT_TASK_POLL_INTERVAL == 0.5
        assert settings.AGENT_TASK_TIMEOUT == 120.0

    def test_frontend_url_default(self) -> None:
        """Test default frontend URL."""
        settings = Settings()
        assert settings.FRONTEND_URL == "http://localhost:3000"


class TestCacheSettings:
    """Tests for cache settings."""

    def test_cache_ttl_templates_default(self) -> None:
        """Test default templates cache TTL."""
        settings = Settings()
        assert settings.CACHE_TTL_TEMPLATES == 3600

    def test_cache_ttl_sessions_default(self) -> None:
        """Test default sessions cache TTL."""
        settings = Settings()
        assert settings.CACHE_TTL_SESSIONS == 300

    def test_cache_ttl_user_config_default(self) -> None:
        """Test default user config cache TTL."""
        settings = Settings()
        assert settings.CACHE_TTL_USER_CONFIG == 600

    def test_cache_prefix_default(self) -> None:
        """Test default cache prefix."""
        settings = Settings()
        assert settings.CACHE_PREFIX == "podex:cache:"


class TestVoiceSettings:
    """Tests for voice/audio settings."""

    def test_default_polly_voice(self) -> None:
        """Test default Polly voice."""
        settings = Settings()
        assert settings.DEFAULT_POLLY_VOICE_ID == "Joanna"

    def test_default_polly_engine(self) -> None:
        """Test default Polly engine."""
        settings = Settings()
        assert settings.DEFAULT_POLLY_ENGINE == "neural"

    def test_default_transcribe_language(self) -> None:
        """Test default Transcribe language."""
        settings = Settings()
        assert settings.DEFAULT_TRANSCRIBE_LANGUAGE == "en-US"


class TestRateLimitSettings:
    """Tests for rate limiting settings."""

    def test_rate_limit_per_minute_default(self) -> None:
        """Test default rate limit per minute."""
        settings = Settings()
        assert settings.RATE_LIMIT_PER_MINUTE == 100


class TestSecuritySettings:
    """Tests for security settings."""

    def test_csp_enabled_default(self) -> None:
        """Test CSP enabled default."""
        settings = Settings()
        assert settings.CSP_ENABLED is True

    def test_csrf_enabled_in_dev_default(self) -> None:
        """Test CSRF in dev default."""
        settings = Settings()
        assert settings.CSRF_ENABLED_IN_DEV is False


class TestSentrySettings:
    """Tests for Sentry settings."""

    def test_sentry_dsn_default(self) -> None:
        """Test Sentry DSN default."""
        settings = Settings()
        assert settings.SENTRY_DSN is None

    def test_sentry_traces_sample_rate_default(self) -> None:
        """Test Sentry traces sample rate."""
        settings = Settings()
        assert settings.SENTRY_TRACES_SAMPLE_RATE == 0.2

    def test_sentry_profiles_sample_rate_default(self) -> None:
        """Test Sentry profiles sample rate."""
        settings = Settings()
        assert settings.SENTRY_PROFILES_SAMPLE_RATE == 0.1


class TestMCPSettings:
    """Tests for MCP configuration."""

    def test_mcp_enabled_servers_default(self) -> None:
        """Test MCP enabled servers default."""
        settings = Settings()
        assert settings.MCP_ENABLED_SERVERS == ""

    def test_mcp_auto_discover_default(self) -> None:
        """Test MCP auto discover default."""
        settings = Settings()
        assert settings.MCP_AUTO_DISCOVER is True

    def test_enabled_mcp_servers_property_empty(self) -> None:
        """Test enabled_mcp_servers property with empty string."""
        settings = Settings()
        assert settings.enabled_mcp_servers == []

    def test_enabled_mcp_servers_property_single(self) -> None:
        """Test enabled_mcp_servers property with single server."""
        settings = Settings(MCP_ENABLED_SERVERS="filesystem")
        assert settings.enabled_mcp_servers == ["filesystem"]

    def test_enabled_mcp_servers_property_multiple(self) -> None:
        """Test enabled_mcp_servers property with multiple servers."""
        settings = Settings(MCP_ENABLED_SERVERS="filesystem,git,github")
        assert settings.enabled_mcp_servers == ["filesystem", "git", "github"]

    def test_enabled_mcp_servers_property_with_spaces(self) -> None:
        """Test enabled_mcp_servers property trims spaces."""
        settings = Settings(MCP_ENABLED_SERVERS="filesystem , git , github ")
        assert settings.enabled_mcp_servers == ["filesystem", "git", "github"]


class TestJWTSecretValidation:
    """Tests for JWT secret key validation."""

    def test_dev_secret_allowed_in_development(self) -> None:
        """Test default JWT secret is allowed in development."""
        with patch.dict(os.environ, {"ENVIRONMENT": "development"}, clear=False):
            settings = Settings(JWT_SECRET_KEY="dev-secret-key-for-local-development")
            assert settings.JWT_SECRET_KEY == "dev-secret-key-for-local-development"

    def test_dev_secret_rejected_in_production(self) -> None:
        """Test default JWT secret is rejected in production."""
        from pydantic import ValidationError as PydanticValidationError

        with patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=False):
            with pytest.raises(PydanticValidationError) as exc:
                Settings(JWT_SECRET_KEY="dev-secret-key-for-local-development")
            # The underlying error message should mention the default value issue
            assert "default value" in str(exc.value).lower() or "JWT_SECRET_KEY" in str(exc.value)

    def test_short_secret_rejected_in_production(self) -> None:
        """Test short JWT secret is rejected in production."""
        from pydantic import ValidationError as PydanticValidationError

        with patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=False):
            with pytest.raises(PydanticValidationError) as exc:
                Settings(JWT_SECRET_KEY="short-key")
            # The underlying error message should mention the length issue
            assert "32 characters" in str(exc.value) or "JWT_SECRET_KEY" in str(exc.value)

    def test_valid_secret_accepted_in_production(self) -> None:
        """Test valid JWT secret is accepted in production."""
        long_secret = "x" * MIN_JWT_SECRET_LENGTH
        with patch.dict(
            os.environ,
            {"ENVIRONMENT": "production", "COMPUTE_INTERNAL_API_KEY": "test-key"},
            clear=False,
        ):
            settings = Settings(JWT_SECRET_KEY=long_secret)
            assert settings.JWT_SECRET_KEY == long_secret


class TestCustomSettings:
    """Tests for custom settings values."""

    def test_custom_environment(self) -> None:
        """Test custom environment setting."""
        settings = Settings(ENVIRONMENT="staging")
        assert settings.ENVIRONMENT == "staging"

    def test_custom_port(self) -> None:
        """Test custom port setting."""
        settings = Settings(PORT=8080)
        assert settings.PORT == 8080

    def test_custom_debug(self) -> None:
        """Test custom debug setting."""
        settings = Settings(DEBUG=True)
        assert settings.DEBUG is True

    def test_custom_cors_origins(self) -> None:
        """Test custom CORS origins."""
        settings = Settings(CORS_ORIGINS=["https://example.com", "https://api.example.com"])
        assert len(settings.CORS_ORIGINS) == 2

    def test_custom_rate_limit(self) -> None:
        """Test custom rate limit."""
        settings = Settings(RATE_LIMIT_PER_MINUTE=200)
        assert settings.RATE_LIMIT_PER_MINUTE == 200


class TestAdminSettings:
    """Tests for admin settings."""

    def test_admin_super_user_emails_default(self) -> None:
        """Test admin super user emails default."""
        settings = Settings()
        assert settings.ADMIN_SUPER_USER_EMAILS == []

    def test_dev_seed_admin_default(self) -> None:
        """Test dev seed admin default."""
        settings = Settings()
        assert settings.DEV_SEED_ADMIN is True


class TestGetSettingsCached:
    """Tests for cached settings retrieval."""

    def test_get_settings_returns_settings(self) -> None:
        """Test get_settings returns a Settings instance."""
        # Clear the cache to test fresh retrieval
        get_settings.cache_clear()
        settings = get_settings()
        assert isinstance(settings, Settings)

    def test_get_settings_is_cached(self) -> None:
        """Test get_settings returns cached instance."""
        get_settings.cache_clear()
        settings1 = get_settings()
        settings2 = get_settings()
        assert settings1 is settings2


class TestS3Settings:
    """Tests for S3 settings."""

    def test_s3_bucket_default(self) -> None:
        """Test default S3 bucket."""
        settings = Settings()
        assert settings.S3_BUCKET == "podex-workspaces"

    def test_s3_workspace_prefix_default(self) -> None:
        """Test default S3 workspace prefix."""
        settings = Settings()
        assert settings.S3_WORKSPACE_PREFIX == "workspaces"

    def test_voice_audio_s3_prefix_default(self) -> None:
        """Test default voice audio S3 prefix."""
        settings = Settings()
        assert settings.VOICE_AUDIO_S3_PREFIX == "audio/voice"


class TestEmailSettings:
    """Tests for email settings."""

    def test_email_from_address_default(self) -> None:
        """Test default email from address."""
        settings = Settings()
        assert settings.EMAIL_FROM_ADDRESS == "noreply@podex.dev"

    def test_email_from_name_default(self) -> None:
        """Test default email from name."""
        settings = Settings()
        assert settings.EMAIL_FROM_NAME == "Podex"

    def test_email_reply_to_default(self) -> None:
        """Test default email reply-to."""
        settings = Settings()
        assert settings.EMAIL_REPLY_TO == "support@podex.dev"
