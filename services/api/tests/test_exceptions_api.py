"""Comprehensive tests for custom exceptions."""

from src.exceptions import (
    AgentClientError,
    AgentServiceConnectionError,
    AgentServiceHTTPError,
    AgentServiceTimeoutError,
    AgentTaskFailedError,
    AgentTaskMissingIdError,
    AgentTaskNoResponseError,
    AgentTaskNotFoundError,
    AgentTaskTimeoutError,
    AlembicConfigNotFoundError,
    AlembicNotFoundError,
    ComputeClientError,
    ComputeServiceConnectionError,
    ComputeServiceHTTPError,
    ConfigurationError,
    DefaultSecretKeyError,
    EmptyMessageContentError,
    FileNotFoundInStorageError,
    InvalidAgentRoleError,
    MessageContentTooLargeError,
    MigrationError,
    MigrationExecutionError,
    MigrationFileNotFoundError,
    ShortSecretKeyError,
    ValidationError,
)


class TestConfigurationErrors:
    """Tests for configuration-related exceptions."""

    def test_configuration_error_base(self) -> None:
        """Test ConfigurationError base class."""
        error = ConfigurationError("Test config error")
        assert str(error) == "Test config error"
        assert isinstance(error, ValueError)

    def test_default_secret_key_error(self) -> None:
        """Test DefaultSecretKeyError message."""
        error = DefaultSecretKeyError()
        assert "JWT_SECRET_KEY" in str(error)
        assert "production" in str(error)
        assert "default" in str(error)

    def test_short_secret_key_error(self) -> None:
        """Test ShortSecretKeyError message."""
        error = ShortSecretKeyError()
        assert "JWT_SECRET_KEY" in str(error)
        assert "32 characters" in str(error)

    def test_default_secret_key_error_inheritance(self) -> None:
        """Test DefaultSecretKeyError inherits from ConfigurationError."""
        error = DefaultSecretKeyError()
        assert isinstance(error, ConfigurationError)
        assert isinstance(error, ValueError)

    def test_short_secret_key_error_inheritance(self) -> None:
        """Test ShortSecretKeyError inherits from ConfigurationError."""
        error = ShortSecretKeyError()
        assert isinstance(error, ConfigurationError)
        assert isinstance(error, ValueError)


class TestMigrationErrors:
    """Tests for database migration exceptions."""

    def test_migration_error_base(self) -> None:
        """Test MigrationError base class."""
        error = MigrationError("Test migration error")
        assert str(error) == "Test migration error"
        assert isinstance(error, RuntimeError)

    def test_alembic_not_found_error(self) -> None:
        """Test AlembicNotFoundError message."""
        error = AlembicNotFoundError()
        assert "alembic command not found" in str(error)
        assert isinstance(error, MigrationError)

    def test_alembic_config_not_found_error(self) -> None:
        """Test AlembicConfigNotFoundError message."""
        error = AlembicConfigNotFoundError("/path/to/alembic.ini")
        assert "/path/to/alembic.ini" in str(error)
        assert "alembic.ini not found" in str(error)
        assert error.config_path == "/path/to/alembic.ini"

    def test_migration_execution_error(self) -> None:
        """Test MigrationExecutionError message."""
        error = MigrationExecutionError(1, "Some error output")
        assert "exit code 1" in str(error)
        assert "Some error output" in str(error)
        assert error.exit_code == 1
        assert error.error_output == "Some error output"

    def test_migration_file_not_found_error(self) -> None:
        """Test MigrationFileNotFoundError message."""
        error = MigrationFileNotFoundError("file.py not found")
        assert "file.py not found" in str(error)
        assert error.original_error == "file.py not found"


class TestComputeClientErrors:
    """Tests for compute service exceptions."""

    def test_compute_client_error_base(self) -> None:
        """Test ComputeClientError base class."""
        error = ComputeClientError("Test compute error")
        assert str(error) == "Test compute error"
        assert error.message == "Test compute error"
        assert error.status_code is None

    def test_compute_client_error_with_status(self) -> None:
        """Test ComputeClientError with status code."""
        error = ComputeClientError("Test error", status_code=500)
        assert error.status_code == 500

    def test_compute_service_connection_error(self) -> None:
        """Test ComputeServiceConnectionError message."""
        error = ComputeServiceConnectionError("Connection refused")
        assert "Connection refused" in str(error)
        assert "Failed to connect" in str(error)
        assert error.original_error == "Connection refused"

    def test_compute_service_http_error(self) -> None:
        """Test ComputeServiceHTTPError message."""
        error = ComputeServiceHTTPError(404, "Not found")
        assert "Not found" in str(error)
        assert error.status_code == 404
        assert error.detail == "Not found"


class TestValidationErrors:
    """Tests for validation exceptions."""

    def test_validation_error_base(self) -> None:
        """Test ValidationError base class."""
        error = ValidationError("Test validation error")
        assert str(error) == "Test validation error"
        assert isinstance(error, ValueError)

    def test_invalid_agent_role_error(self) -> None:
        """Test InvalidAgentRoleError message."""
        error = InvalidAgentRoleError("invalid", ["admin", "user", "viewer"])
        assert "invalid" in str(error)
        assert "admin" in str(error)
        assert error.role == "invalid"
        assert error.valid_roles == ["admin", "user", "viewer"]

    def test_message_content_too_large_error(self) -> None:
        """Test MessageContentTooLargeError message."""
        error = MessageContentTooLargeError(100)
        assert "100KB" in str(error)
        assert "too large" in str(error)
        assert error.max_size_kb == 100

    def test_empty_message_content_error(self) -> None:
        """Test EmptyMessageContentError message."""
        error = EmptyMessageContentError()
        assert "empty" in str(error).lower()


class TestFileErrors:
    """Tests for file-related exceptions."""

    def test_file_not_found_in_storage_error(self) -> None:
        """Test FileNotFoundInStorageError message."""
        error = FileNotFoundInStorageError("/workspace/file.txt")
        assert "/workspace/file.txt" in str(error)
        assert "not found" in str(error).lower()
        assert error.path == "/workspace/file.txt"
        assert isinstance(error, FileNotFoundError)


class TestAgentClientErrors:
    """Tests for agent service exceptions."""

    def test_agent_client_error_base(self) -> None:
        """Test AgentClientError base class."""
        error = AgentClientError("Test agent error")
        assert str(error) == "Test agent error"
        assert isinstance(error, Exception)

    def test_agent_service_timeout_error(self) -> None:
        """Test AgentServiceTimeoutError message."""
        error = AgentServiceTimeoutError("timeout")
        assert "timeout" in str(error).lower()
        assert error.original_error == "timeout"

    def test_agent_service_http_error(self) -> None:
        """Test AgentServiceHTTPError message."""
        error = AgentServiceHTTPError(503, "Service unavailable")
        assert "503" in str(error)
        assert "Service unavailable" in str(error)
        assert error.status_code == 503
        assert error.detail == "Service unavailable"

    def test_agent_service_connection_error(self) -> None:
        """Test AgentServiceConnectionError message."""
        error = AgentServiceConnectionError("Connection refused")
        assert "Connection refused" in str(error)
        assert "Failed to connect" in str(error)
        assert error.original_error == "Connection refused"

    def test_agent_task_missing_id_error(self) -> None:
        """Test AgentTaskMissingIdError message."""
        error = AgentTaskMissingIdError()
        assert "task_id" in str(error).lower()

    def test_agent_task_no_response_error(self) -> None:
        """Test AgentTaskNoResponseError message."""
        error = AgentTaskNoResponseError()
        assert "no response" in str(error).lower()

    def test_agent_task_failed_error(self) -> None:
        """Test AgentTaskFailedError message."""
        error = AgentTaskFailedError("Something went wrong")
        assert "Something went wrong" in str(error)
        assert error.error == "Something went wrong"

    def test_agent_task_not_found_error(self) -> None:
        """Test AgentTaskNotFoundError message."""
        error = AgentTaskNotFoundError("task-123")
        assert "task-123" in str(error)
        assert "not found" in str(error).lower()
        assert error.task_id == "task-123"

    def test_agent_task_timeout_error(self) -> None:
        """Test AgentTaskTimeoutError message."""
        error = AgentTaskTimeoutError("task-456", 30.0)
        assert "task-456" in str(error)
        assert "30" in str(error)
        assert "timed out" in str(error).lower()
        assert error.task_id == "task-456"
        assert error.timeout == 30.0


class TestExceptionInheritance:
    """Tests for exception hierarchy."""

    def test_compute_errors_inheritance(self) -> None:
        """Test compute error inheritance chain."""
        conn_error = ComputeServiceConnectionError("test")
        http_error = ComputeServiceHTTPError(500, "test")

        assert isinstance(conn_error, ComputeClientError)
        assert isinstance(http_error, ComputeClientError)

    def test_agent_errors_inheritance(self) -> None:
        """Test agent error inheritance chain."""
        errors = [
            AgentServiceTimeoutError("test"),
            AgentServiceHTTPError(500, "test"),
            AgentServiceConnectionError("test"),
            AgentTaskMissingIdError(),
            AgentTaskNoResponseError(),
            AgentTaskFailedError("test"),
            AgentTaskNotFoundError("test"),
            AgentTaskTimeoutError("test", 30.0),
        ]

        for error in errors:
            assert isinstance(error, AgentClientError)

    def test_migration_errors_inheritance(self) -> None:
        """Test migration error inheritance chain."""
        errors = [
            AlembicNotFoundError(),
            AlembicConfigNotFoundError("/path"),
            MigrationExecutionError(1, "error"),
            MigrationFileNotFoundError("error"),
        ]

        for error in errors:
            assert isinstance(error, MigrationError)
            assert isinstance(error, RuntimeError)

    def test_validation_errors_inheritance(self) -> None:
        """Test validation error inheritance chain."""
        errors = [
            InvalidAgentRoleError("test", ["a", "b"]),
            MessageContentTooLargeError(100),
            EmptyMessageContentError(),
        ]

        for error in errors:
            assert isinstance(error, ValidationError)
            assert isinstance(error, ValueError)
