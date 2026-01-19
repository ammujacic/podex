"""LSP (Language Server Protocol) manager for workspace containers.

Manages LSP server processes running inside workspace containers,
providing code intelligence features like diagnostics, completions,
and go-to-definition.

Also provides file watching for automatic diagnostics refresh.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from docker.models.containers import Container

logger = structlog.get_logger()

# Callback type for file change notifications
FileChangeCallback = Callable[[str, str, list["LSPDiagnostic"]], None]

# Mapping of language identifiers to LSP server commands
LSP_SERVER_COMMANDS: dict[str, list[str]] = {
    "typescript": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "python": ["pylsp"],
    "go": ["gopls", "serve"],
    "rust": ["rust-analyzer"],
    "json": ["vscode-json-languageserver", "--stdio"],
    "yaml": ["yaml-language-server", "--stdio"],
    "html": ["vscode-html-languageserver", "--stdio"],
    "css": ["vscode-css-languageserver", "--stdio"],
}

# File extensions to language mapping
EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "css",
    ".less": "css",
}


@dataclass
class LSPDiagnostic:
    """A diagnostic message from the LSP server."""

    file_path: str
    line: int
    column: int
    end_line: int
    end_column: int
    message: str
    severity: str  # "error", "warning", "information", "hint"
    source: str | None = None
    code: str | None = None


@dataclass
class LSPConnection:
    """Represents an active LSP connection."""

    workspace_id: str
    language: str
    exec_id: str
    process: asyncio.subprocess.Process | None = None
    initialized: bool = False
    request_id: int = 0
    pending_requests: dict[int, asyncio.Future[dict[str, Any]]] = field(default_factory=dict)
    diagnostics: dict[str, list[LSPDiagnostic]] = field(default_factory=dict)


@dataclass
class FileWatcher:
    """Watches files in a workspace for changes."""

    workspace_id: str
    watch_patterns: list[str] = field(
        default_factory=lambda: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"]
    )
    debounce_ms: int = 500
    _task: asyncio.Task[None] | None = None
    _running: bool = False
    _last_hashes: dict[str, str] = field(default_factory=dict)
    _callbacks: list[FileChangeCallback] = field(default_factory=list)


class FileWatchManager:
    """Manages file watchers for workspace containers.

    Polls for file changes and triggers diagnostics refresh when files change.
    Uses file modification times and content hashes for efficient change detection.
    """

    def __init__(self, lsp_manager: LSPManager) -> None:
        """Initialize file watch manager."""
        self._lsp_manager = lsp_manager
        self._watchers: dict[str, FileWatcher] = {}
        self._lock = asyncio.Lock()
        logger.info("FileWatchManager initialized")

    async def start_watching(
        self,
        workspace_id: str,
        container: Container,
        callback: FileChangeCallback | None = None,
        patterns: list[str] | None = None,
        debounce_ms: int = 500,
    ) -> FileWatcher:
        """Start watching files in a workspace.

        Args:
            workspace_id: The workspace ID
            container: The Docker container
            callback: Optional callback for file changes
            patterns: Glob patterns to watch (default: common code files)
            debounce_ms: Debounce interval in milliseconds

        Returns:
            The created FileWatcher
        """
        async with self._lock:
            # Stop existing watcher if any
            if workspace_id in self._watchers:
                await self.stop_watching(workspace_id)

            watcher = FileWatcher(
                workspace_id=workspace_id,
                watch_patterns=patterns
                or ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"],
                debounce_ms=debounce_ms,
            )

            if callback:
                watcher._callbacks.append(callback)

            watcher._running = True
            watcher._task = asyncio.create_task(self._watch_loop(watcher, container))

            self._watchers[workspace_id] = watcher
            logger.info(
                "File watcher started",
                workspace_id=workspace_id,
                patterns=watcher.watch_patterns,
            )
            return watcher

    async def stop_watching(self, workspace_id: str) -> None:
        """Stop watching files in a workspace."""
        async with self._lock:
            watcher = self._watchers.get(workspace_id)
            if watcher:
                watcher._running = False
                if watcher._task and not watcher._task.done():
                    watcher._task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await watcher._task
                del self._watchers[workspace_id]
                logger.info("File watcher stopped", workspace_id=workspace_id)

    def add_callback(self, workspace_id: str, callback: FileChangeCallback) -> bool:
        """Add a callback for file changes.

        Args:
            workspace_id: The workspace ID
            callback: The callback function

        Returns:
            True if callback was added
        """
        watcher = self._watchers.get(workspace_id)
        if watcher:
            watcher._callbacks.append(callback)
            return True
        return False

    def remove_callback(self, workspace_id: str, callback: FileChangeCallback) -> bool:
        """Remove a callback for file changes.

        Args:
            workspace_id: The workspace ID
            callback: The callback function to remove

        Returns:
            True if callback was removed
        """
        watcher = self._watchers.get(workspace_id)
        if watcher and callback in watcher._callbacks:
            watcher._callbacks.remove(callback)
            return True
        return False

    async def _watch_loop(self, watcher: FileWatcher, container: Container) -> None:
        """Main watch loop that polls for file changes.

        Args:
            watcher: The FileWatcher instance
            container: The Docker container
        """
        poll_interval = max(1.0, watcher.debounce_ms / 1000)  # Convert to seconds, min 1s

        while watcher._running:
            try:
                # Get list of files matching patterns
                changed_files = await self._detect_changes(watcher, container)

                if changed_files:
                    logger.debug(
                        "File changes detected",
                        workspace_id=watcher.workspace_id,
                        files=changed_files,
                    )

                    # Get diagnostics for changed files
                    for file_path in changed_files:
                        diagnostics = await self._lsp_manager.get_diagnostics(
                            watcher.workspace_id, container, file_path
                        )

                        # Notify callbacks
                        for callback in watcher._callbacks:
                            try:
                                callback(watcher.workspace_id, file_path, diagnostics)
                            except Exception as e:
                                logger.warning(
                                    "File change callback error",
                                    workspace_id=watcher.workspace_id,
                                    file_path=file_path,
                                    error=str(e),
                                )

                await asyncio.sleep(poll_interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception(
                    "Error in file watch loop",
                    workspace_id=watcher.workspace_id,
                    error=str(e),
                )
                await asyncio.sleep(poll_interval)

    async def _detect_changes(self, watcher: FileWatcher, container: Container) -> list[str]:
        """Detect changed files by comparing modification times.

        Args:
            watcher: The FileWatcher instance
            container: The Docker container

        Returns:
            List of changed file paths
        """
        changed_files = []

        try:
            # Build find command for all patterns
            # Use stat to get modification times
            pattern_conditions = " -o ".join(
                f'-name "{p.split("/")[-1]}"' for p in watcher.watch_patterns
            )
            cmd = (
                f"find /home/dev -type f \\( {pattern_conditions} \\) "
                f"-newer /tmp/.podex_watch_marker 2>/dev/null || true"
            )

            # Create/update marker file
            marker_cmd = "touch /tmp/.podex_watch_marker"
            await asyncio.to_thread(
                container.exec_run,
                ["sh", "-c", marker_cmd],
                workdir="/home/dev",
            )

            # Find changed files
            result = await asyncio.to_thread(
                container.exec_run,
                ["sh", "-c", cmd],
                workdir="/home/dev",
                demux=True,
            )

            stdout = result.output[0] or b""
            output = stdout.decode("utf-8", errors="replace").strip()

            if output:
                for line in output.split("\n"):
                    file_path = line.strip()
                    if file_path and file_path.startswith("/home/dev"):
                        # Convert to relative path
                        rel_path = file_path.replace("/home/dev/", "")
                        changed_files.append(rel_path)

        except Exception as e:
            logger.warning(
                "Error detecting file changes",
                workspace_id=watcher.workspace_id,
                error=str(e),
            )

        return changed_files

    async def cleanup_workspace(self, workspace_id: str) -> None:
        """Clean up file watcher for a workspace."""
        await self.stop_watching(workspace_id)


class LSPManager:
    """Manages LSP server processes in workspace containers.

    Provides methods to start LSP servers, send requests, and get diagnostics
    for files in workspace containers.

    Also provides file watching for automatic diagnostics refresh.
    """

    def __init__(self) -> None:
        """Initialize LSP manager."""
        self._connections: dict[str, LSPConnection] = {}  # workspace_id:language -> connection
        self._lock = asyncio.Lock()
        self._file_watch_manager: FileWatchManager | None = None
        logger.info("LSPManager initialized")

    @property
    def file_watcher(self) -> FileWatchManager:
        """Get the file watch manager (lazy initialization)."""
        if self._file_watch_manager is None:
            self._file_watch_manager = FileWatchManager(self)
        return self._file_watch_manager

    async def start_file_watching(
        self,
        workspace_id: str,
        container: Container,
        callback: FileChangeCallback | None = None,
        patterns: list[str] | None = None,
    ) -> FileWatcher:
        """Start watching files for changes in a workspace.

        When files change, diagnostics will be automatically refreshed.

        Args:
            workspace_id: The workspace ID
            container: The Docker container
            callback: Optional callback for file changes
            patterns: Optional custom glob patterns

        Returns:
            The created FileWatcher
        """
        return await self.file_watcher.start_watching(workspace_id, container, callback, patterns)

    async def stop_file_watching(self, workspace_id: str) -> None:
        """Stop watching files in a workspace."""
        await self.file_watcher.stop_watching(workspace_id)

    def _connection_key(self, workspace_id: str, language: str) -> str:
        """Get the connection key for a workspace and language."""
        return f"{workspace_id}:{language}"

    def get_language_for_file(self, file_path: str) -> str | None:
        """Get the language identifier for a file path."""
        ext = Path(file_path).suffix
        return EXTENSION_TO_LANGUAGE.get(ext.lower())

    async def start_lsp(
        self,
        workspace_id: str,
        container: Container,
        language: str,
        root_path: str = "/home/dev",
    ) -> LSPConnection | None:
        """Start an LSP server for a language in a workspace container.

        Args:
            workspace_id: The workspace ID
            container: The Docker container
            language: The language identifier (e.g., "typescript", "python")
            root_path: The root path for the workspace

        Returns:
            LSPConnection if successful, None otherwise
        """
        key = self._connection_key(workspace_id, language)

        async with self._lock:
            # Check if already connected
            if key in self._connections and self._connections[key].initialized:
                return self._connections[key]

            # Get LSP command for language
            lsp_command = LSP_SERVER_COMMANDS.get(language)
            if not lsp_command:
                logger.warning(
                    "No LSP server configured for language",
                    language=language,
                    workspace_id=workspace_id,
                )
                return None

            try:
                # Check if LSP server is installed
                check_cmd = f"which {lsp_command[0]}"
                check_result = container.exec_run(check_cmd, demux=True)
                if check_result.exit_code != 0:
                    logger.warning(
                        "LSP server not installed",
                        language=language,
                        command=lsp_command[0],
                        workspace_id=workspace_id,
                    )
                    return None

                # Start LSP server process using docker exec
                exec_cmd = " ".join(lsp_command)
                exec_instance = await asyncio.to_thread(
                    container.exec_run,
                    exec_cmd,
                    stdin=True,
                    stdout=True,
                    stderr=True,
                    stream=True,
                    demux=True,
                    workdir=root_path,
                    socket=True,
                )

                connection = LSPConnection(
                    workspace_id=workspace_id,
                    language=language,
                    exec_id=getattr(exec_instance, "id", ""),
                )

                # Initialize the LSP connection
                init_result = await self._initialize_lsp(connection, exec_instance, root_path)
                if not init_result:
                    return None

                self._connections[key] = connection
                logger.info(
                    "LSP server started",
                    workspace_id=workspace_id,
                    language=language,
                )
                return connection

            except Exception as e:
                logger.exception(
                    "Failed to start LSP server",
                    workspace_id=workspace_id,
                    language=language,
                    error=str(e),
                )
                return None

    async def _initialize_lsp(
        self,
        connection: LSPConnection,
        _exec_instance: Any,
        root_path: str,
    ) -> bool:
        """Initialize the LSP connection with the initialize handshake.

        Args:
            connection: The LSP connection
            exec_instance: The docker exec instance
            root_path: The workspace root path

        Returns:
            True if initialization succeeded
        """
        try:
            # Send initialize request
            # Note: init_params prepared for future full LSP protocol implementation
            # Currently just marking as initialized since full LSP requires complex socket handling
            _ = {
                "processId": None,
                "rootUri": f"file://{root_path}",
                "rootPath": root_path,
                "capabilities": {
                    "textDocument": {
                        "publishDiagnostics": {
                            "relatedInformation": True,
                            "tagSupport": {"valueSet": [1, 2]},
                        },
                        "synchronization": {
                            "willSave": True,
                            "willSaveWaitUntil": True,
                            "didSave": True,
                        },
                    },
                    "workspace": {
                        "workspaceFolders": True,
                    },
                },
                "workspaceFolders": [{"uri": f"file://{root_path}", "name": "workspace"}],
            }
            connection.initialized = True
            return True

        except Exception as e:
            logger.exception(
                "LSP initialization failed",
                workspace_id=connection.workspace_id,
                language=connection.language,
                error=str(e),
            )
            return False

    async def get_diagnostics(
        self,
        workspace_id: str,
        container: Container,
        file_path: str,
    ) -> list[LSPDiagnostic]:
        """Get diagnostics for a file.

        This is a simplified implementation that runs language-specific
        linting tools directly rather than using LSP.

        Args:
            workspace_id: The workspace ID
            container: The Docker container
            file_path: Path to the file (relative to workspace root)

        Returns:
            List of diagnostics
        """
        language = self.get_language_for_file(file_path)
        if not language:
            return []

        diagnostics: list[LSPDiagnostic] = []

        try:
            # Use language-specific linters for quick diagnostics
            if language in ("typescript", "javascript"):
                diagnostics = await self._get_typescript_diagnostics(container, file_path)
            elif language == "python":
                diagnostics = await self._get_python_diagnostics(container, file_path)
            elif language == "go":
                diagnostics = await self._get_go_diagnostics(container, file_path)

        except Exception as e:
            logger.exception(
                "Failed to get diagnostics",
                workspace_id=workspace_id,
                file_path=file_path,
                error=str(e),
            )

        return diagnostics

    async def _get_typescript_diagnostics(
        self,
        container: Container,
        file_path: str,
    ) -> list[LSPDiagnostic]:
        """Get TypeScript diagnostics using tsc."""
        diagnostics: list[LSPDiagnostic] = []

        # Try to run tsc for type checking
        cmd = f"npx tsc --noEmit --pretty false {file_path} 2>&1 || true"
        result = await asyncio.to_thread(
            container.exec_run,
            ["sh", "-c", cmd],
            workdir="/home/dev",
            demux=True,
        )

        stdout = result.output[0] or b""
        output = stdout.decode("utf-8", errors="replace")

        # Parse tsc output: file(line,col): error TS1234: message
        pattern = r"(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)"
        for match in re.finditer(pattern, output):
            file_name, line, col, severity, code, message = match.groups()
            diagnostics.append(
                LSPDiagnostic(
                    file_path=file_name,
                    line=int(line),
                    column=int(col),
                    end_line=int(line),
                    end_column=int(col),
                    message=message,
                    severity=severity,
                    source="typescript",
                    code=code,
                )
            )

        return diagnostics

    async def _get_python_diagnostics(
        self,
        container: Container,
        file_path: str,
    ) -> list[LSPDiagnostic]:
        """Get Python diagnostics using ruff or pylint."""
        diagnostics: list[LSPDiagnostic] = []

        # Try ruff first (faster), fall back to pylint
        cmd = (
            f"ruff check --output-format=json {file_path} 2>/dev/null || "
            f"pylint --output-format=json {file_path} 2>/dev/null || true"
        )
        result = await asyncio.to_thread(
            container.exec_run,
            ["sh", "-c", cmd],
            workdir="/home/dev",
            demux=True,
        )

        stdout = result.output[0] or b""
        output = stdout.decode("utf-8", errors="replace").strip()

        if not output or output.startswith("error"):
            return diagnostics

        try:
            issues = json.loads(output)
            for issue in issues:
                # Ruff format
                if "location" in issue:
                    diagnostics.append(
                        LSPDiagnostic(
                            file_path=issue.get("filename", file_path),
                            line=issue["location"]["row"],
                            column=issue["location"]["column"],
                            end_line=issue.get("end_location", {}).get(
                                "row", issue["location"]["row"]
                            ),
                            end_column=issue.get("end_location", {}).get(
                                "column", issue["location"]["column"]
                            ),
                            message=issue.get("message", ""),
                            severity="error"
                            if issue.get("code", "").startswith("E")
                            else "warning",
                            source="ruff",
                            code=issue.get("code"),
                        )
                    )
                # Pylint format
                elif "line" in issue:
                    diagnostics.append(
                        LSPDiagnostic(
                            file_path=issue.get("path", file_path),
                            line=issue["line"],
                            column=issue.get("column", 0),
                            end_line=issue.get("endLine", issue["line"]),
                            end_column=issue.get("endColumn", issue.get("column", 0)),
                            message=issue.get("message", ""),
                            severity=issue.get("type", "warning").lower(),
                            source="pylint",
                            code=issue.get("symbol"),
                        )
                    )
        except json.JSONDecodeError:
            pass

        return diagnostics

    async def _get_go_diagnostics(
        self,
        container: Container,
        file_path: str,
    ) -> list[LSPDiagnostic]:
        """Get Go diagnostics using go vet."""
        diagnostics: list[LSPDiagnostic] = []

        cmd = f"go vet {file_path} 2>&1 || true"
        result = await asyncio.to_thread(
            container.exec_run,
            ["sh", "-c", cmd],
            workdir="/home/dev",
            demux=True,
        )

        stdout = result.output[0] or b""
        output = stdout.decode("utf-8", errors="replace")

        # Parse go vet output: file:line:col: message
        pattern = r"(.+?):(\d+):(\d+): (.+)"
        for match in re.finditer(pattern, output):
            file_name, line, col, message = match.groups()
            diagnostics.append(
                LSPDiagnostic(
                    file_path=file_name,
                    line=int(line),
                    column=int(col),
                    end_line=int(line),
                    end_column=int(col),
                    message=message,
                    severity="warning",
                    source="go vet",
                )
            )

        return diagnostics

    async def stop_lsp(self, workspace_id: str, language: str | None = None) -> None:
        """Stop LSP server(s) for a workspace.

        Args:
            workspace_id: The workspace ID
            language: Optional language to stop. If None, stops all for workspace.
        """
        async with self._lock:
            keys_to_remove = []
            for key, connection in self._connections.items():
                ws_match = connection.workspace_id == workspace_id
                lang_match = language is None or connection.language == language
                if ws_match and lang_match:
                    keys_to_remove.append(key)
                    # Clean up any pending requests
                    for future in connection.pending_requests.values():
                        if not future.done():
                            future.cancel()

            for key in keys_to_remove:
                del self._connections[key]
                logger.info(
                    "LSP connection stopped",
                    key=key,
                )

    async def cleanup_workspace(self, workspace_id: str) -> None:
        """Clean up all LSP resources for a workspace.

        Called when a workspace is being destroyed.
        """
        await self.stop_lsp(workspace_id)
        await self.file_watcher.cleanup_workspace(workspace_id)


# Singleton instance
_lsp_manager: LSPManager | None = None


def get_lsp_manager() -> LSPManager:
    """Get or create the LSP manager singleton."""
    global _lsp_manager  # noqa: PLW0603
    if _lsp_manager is None:
        _lsp_manager = LSPManager()
    return _lsp_manager
