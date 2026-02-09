"""Custom exception classes for the API service."""


class ConfigurationError(ValueError):
    """Raised when configuration validation fails."""


class DefaultSecretKeyError(ConfigurationError):
    """Raised when default JWT secret key is used in production."""

    def __init__(self) -> None:
        super().__init__(
            "JWT_SECRET_KEY must be changed from the default value in production. "
            "Set the JWT_SECRET_KEY environment variable to a secure random string.",
        )


class ShortSecretKeyError(ConfigurationError):
    """Raised when JWT secret key is too short in production."""

    def __init__(self) -> None:
        super().__init__("JWT_SECRET_KEY must be at least 32 characters in production.")


class MigrationError(RuntimeError):
    """Raised when database migration fails."""


class AlembicNotFoundError(MigrationError):
    """Raised when alembic command is not found."""

    def __init__(self) -> None:
        super().__init__("Database migration failed: alembic command not found")


class AlembicConfigNotFoundError(MigrationError):
    """Raised when alembic.ini configuration file is not found."""

    def __init__(self, config_path: str) -> None:
        self.config_path = config_path
        super().__init__(f"Database migration failed: alembic.ini not found at {config_path}")


class MigrationExecutionError(MigrationError):
    """Raised when alembic migration execution fails."""

    def __init__(self, exit_code: int, error_output: str) -> None:
        self.exit_code = exit_code
        self.error_output = error_output
        super().__init__(f"Database migration failed (exit code {exit_code}):\n{error_output}")


class MigrationFileNotFoundError(MigrationError):
    """Raised when migration fails due to file not found."""

    def __init__(self, original_error: str) -> None:
        self.original_error = original_error
        super().__init__(f"Database migration failed: {original_error}")


class ComputeClientError(Exception):
    """Base exception for compute service call failures."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ComputeServiceConnectionError(ComputeClientError):
    """Raised when connection to compute service fails."""

    def __init__(self, original_error: str) -> None:
        self.original_error = original_error
        super().__init__(f"Failed to connect to compute service: {original_error}")


class ComputeServiceHTTPError(ComputeClientError):
    """Raised when compute service returns an HTTP error."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.detail = detail
        super().__init__(f"Compute service error: {detail}", status_code=status_code)


class ValidationError(ValueError):
    """Base class for validation errors."""


class InvalidAgentRoleError(ValidationError):
    """Raised when an invalid agent role is provided."""

    def __init__(self, role: str, valid_roles: list[str]) -> None:
        self.role = role
        self.valid_roles = valid_roles
        super().__init__(f"Invalid role '{role}'. Must be one of: {valid_roles}")


class MessageContentTooLargeError(ValidationError):
    """Raised when message content exceeds maximum size."""

    def __init__(self, max_size_kb: int) -> None:
        self.max_size_kb = max_size_kb
        super().__init__(f"Message content too large. Maximum size is {max_size_kb}KB")


class EmptyMessageContentError(ValidationError):
    """Raised when message content is empty."""

    def __init__(self) -> None:
        super().__init__("Message content cannot be empty")


# Agent client exceptions
class AgentClientError(Exception):
    """Base exception for agent service call failures."""


class AgentServiceTimeoutError(AgentClientError):
    """Raised when agent service request times out."""

    def __init__(self, original_error: str) -> None:
        self.original_error = original_error
        super().__init__(f"Request to agent service timed out: {original_error}")


class AgentServiceHTTPError(AgentClientError):
    """Raised when agent service returns an HTTP error."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Agent service returned {status_code}: {detail}")


class AgentServiceConnectionError(AgentClientError):
    """Raised when connection to agent service fails."""

    def __init__(self, original_error: str) -> None:
        self.original_error = original_error
        super().__init__(f"Failed to connect to agent service: {original_error}")


class AgentTaskMissingIdError(AgentClientError):
    """Raised when agent service returns no task ID."""

    def __init__(self) -> None:
        super().__init__("No task_id returned from agent service")


class AgentTaskNoResponseError(AgentClientError):
    """Raised when completed task has no response."""

    def __init__(self) -> None:
        super().__init__("Task completed but no response returned")


class AgentTaskFailedError(AgentClientError):
    """Raised when agent task fails."""

    def __init__(self, error: str) -> None:
        self.error = error
        super().__init__(f"Task failed: {error}")


class AgentTaskNotFoundError(AgentClientError):
    """Raised when agent task is not found."""

    def __init__(self, task_id: str) -> None:
        self.task_id = task_id
        super().__init__(f"Task {task_id} not found")


class AgentTaskTimeoutError(AgentClientError):
    """Raised when waiting for agent task times out."""

    def __init__(self, task_id: str, timeout: float) -> None:
        self.task_id = task_id
        self.timeout = timeout
        super().__init__(f"Task {task_id} timed out after {timeout}s")
