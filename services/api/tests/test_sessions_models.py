"""Comprehensive tests for session routes models and utilities."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Request

from src.routes.sessions import (
    CreateFileRequest,
    FileContent,
    FileNode,
    LayoutResponse,
    LayoutUpdateRequest,
    MoveFileRequest,
    PaginationParams,
    SessionCreate,
    SessionListParams,
    SessionListResponse,
    SessionResponse,
    StandbySettingsRequest,
    StandbySettingsResponse,
    UpdateFileRequest,
    get_current_user_id,
    get_demo_file_tree,
    get_language_from_path,
    get_session_list_params,
    validate_file_path,
)


class TestSessionCreate:
    """Tests for SessionCreate model."""

    def test_session_create_minimal(self) -> None:
        """Test SessionCreate with minimal fields."""
        session = SessionCreate(name="Test Session")
        assert session.name == "Test Session"
        assert session.git_url is None
        assert session.branch == "main"
        assert session.template_id is None

    def test_session_create_full(self) -> None:
        """Test SessionCreate with all fields."""
        session = SessionCreate(
            name="Test Session",
            git_url="https://github.com/user/repo",
            branch="develop",
            template_id="nodejs",
        )
        assert session.name == "Test Session"
        assert session.git_url == "https://github.com/user/repo"
        assert session.branch == "develop"
        assert session.template_id == "nodejs"


class TestSessionResponse:
    """Tests for SessionResponse model."""

    def test_session_response_from_dict(self) -> None:
        """Test SessionResponse can be created from dict."""
        data = {
            "id": "session-123",
            "name": "Test Session",
            "owner_id": "user-456",
            "workspace_id": "ws-789",
            "branch": "main",
            "status": "active",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
        }
        response = SessionResponse(**data)
        assert response.id == "session-123"
        assert response.name == "Test Session"
        assert response.owner_id == "user-456"

    def test_session_response_optional_fields(self) -> None:
        """Test SessionResponse with optional fields."""
        data = {
            "id": "session-123",
            "name": "Test Session",
            "owner_id": "user-456",
            "workspace_id": None,
            "branch": "main",
            "status": "active",
            "template_id": None,
            "git_url": None,
            "archived_at": None,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
        }
        response = SessionResponse(**data)
        assert response.workspace_id is None
        assert response.template_id is None
        assert response.archived_at is None


class TestSessionListResponse:
    """Tests for SessionListResponse model."""

    def test_session_list_response(self) -> None:
        """Test SessionListResponse model."""
        response = SessionListResponse(
            items=[],
            total=0,
            page=1,
            page_size=20,
            has_more=False,
            next_cursor=None,
        )
        assert response.items == []
        assert response.total == 0
        assert response.page == 1
        assert response.has_more is False

    def test_session_list_response_with_items(self) -> None:
        """Test SessionListResponse with items."""
        items = [
            SessionResponse(
                id="session-1",
                name="Session 1",
                owner_id="user-123",
                workspace_id="ws-1",
                branch="main",
                status="active",
                created_at="2024-01-01T00:00:00Z",
                updated_at="2024-01-01T00:00:00Z",
            ),
        ]
        response = SessionListResponse(
            items=items,
            total=1,
            page=1,
            page_size=20,
            has_more=False,
        )
        assert len(response.items) == 1
        assert response.items[0].name == "Session 1"


class TestSessionListParams:
    """Tests for SessionListParams dataclass."""

    def test_session_list_params_defaults(self) -> None:
        """Test SessionListParams default values."""
        params = SessionListParams()
        assert params.page == 1
        assert params.page_size == 20
        assert params.include_archived is False
        assert params.archived_only is False
        assert params.status is None
        assert params.cursor is None

    def test_session_list_params_custom(self) -> None:
        """Test SessionListParams with custom values."""
        params = SessionListParams(
            page=2,
            page_size=50,
            include_archived=True,
            archived_only=False,
            status="active",
            cursor="session-123",
        )
        assert params.page == 2
        assert params.page_size == 50
        assert params.include_archived is True
        assert params.status == "active"


class TestPaginationParams:
    """Tests for PaginationParams dataclass."""

    def test_pagination_params_defaults(self) -> None:
        """Test PaginationParams default values."""
        params = PaginationParams()
        assert params.page == 1
        assert params.page_size == 20
        assert params.cursor is None

    def test_pagination_params_custom(self) -> None:
        """Test PaginationParams with custom values."""
        params = PaginationParams(page=5, page_size=10, cursor="cursor-123")
        assert params.page == 5
        assert params.page_size == 10
        assert params.cursor == "cursor-123"


class TestLayoutModels:
    """Tests for layout-related models."""

    def test_layout_response_defaults(self) -> None:
        """Test LayoutResponse default values."""
        response = LayoutResponse()
        assert response.view_mode == "grid"
        assert response.active_agent_id is None
        assert response.agent_layouts == {}
        assert response.file_preview_layouts == {}
        assert response.sidebar_open is True
        assert response.sidebar_width == 280

    def test_layout_update_request_partial(self) -> None:
        """Test LayoutUpdateRequest with partial data."""
        request = LayoutUpdateRequest(view_mode="list")
        assert request.view_mode == "list"
        assert request.active_agent_id is None
        assert request.sidebar_open is None

    def test_layout_update_request_full(self) -> None:
        """Test LayoutUpdateRequest with all fields."""
        request = LayoutUpdateRequest(
            view_mode="list",
            active_agent_id="agent-123",
            agent_layouts={"agent-1": {"x": 0, "y": 0}},
            file_preview_layouts={"preview-1": {"width": 400}},
            sidebar_open=False,
            sidebar_width=300,
        )
        assert request.view_mode == "list"
        assert request.active_agent_id == "agent-123"
        assert request.sidebar_open is False


class TestStandbySettingsModels:
    """Tests for standby settings models."""

    def test_standby_settings_response(self) -> None:
        """Test StandbySettingsResponse model."""
        response = StandbySettingsResponse(timeout_minutes=30, source="session")
        assert response.timeout_minutes == 30
        assert response.source == "session"

    def test_standby_settings_response_none_timeout(self) -> None:
        """Test StandbySettingsResponse with None timeout (never)."""
        response = StandbySettingsResponse(timeout_minutes=None, source="user_default")
        assert response.timeout_minutes is None
        assert response.source == "user_default"

    def test_standby_settings_request(self) -> None:
        """Test StandbySettingsRequest model."""
        request = StandbySettingsRequest(timeout_minutes=60)
        assert request.timeout_minutes == 60

    def test_standby_settings_request_none(self) -> None:
        """Test StandbySettingsRequest with None (never)."""
        request = StandbySettingsRequest(timeout_minutes=None)
        assert request.timeout_minutes is None


class TestFileModels:
    """Tests for file-related models."""

    def test_file_node_file(self) -> None:
        """Test FileNode for a file."""
        node = FileNode(name="app.tsx", path="src/app.tsx", type="file")
        assert node.name == "app.tsx"
        assert node.path == "src/app.tsx"
        assert node.type == "file"
        assert node.children is None

    def test_file_node_directory(self) -> None:
        """Test FileNode for a directory."""
        node = FileNode(
            name="src",
            path="src",
            type="directory",
            children=[
                FileNode(name="app.tsx", path="src/app.tsx", type="file"),
            ],
        )
        assert node.name == "src"
        assert node.type == "directory"
        assert len(node.children) == 1

    def test_file_content(self) -> None:
        """Test FileContent model."""
        content = FileContent(
            path="src/app.tsx",
            content="export function App() { return <div>Hello</div> }",
            language="typescript",
        )
        assert content.path == "src/app.tsx"
        assert "App" in content.content
        assert content.language == "typescript"

    def test_create_file_request(self) -> None:
        """Test CreateFileRequest model."""
        request = CreateFileRequest(path="src/new.tsx", content="// new file")
        assert request.path == "src/new.tsx"
        assert request.content == "// new file"

    def test_create_file_request_empty_content(self) -> None:
        """Test CreateFileRequest with default empty content."""
        request = CreateFileRequest(path="src/empty.tsx")
        assert request.path == "src/empty.tsx"
        assert request.content == ""

    def test_update_file_request(self) -> None:
        """Test UpdateFileRequest model."""
        request = UpdateFileRequest(content="// updated content")
        assert request.content == "// updated content"

    def test_move_file_request(self) -> None:
        """Test MoveFileRequest model."""
        request = MoveFileRequest(source_path="src/old.tsx", dest_path="src/new.tsx")
        assert request.source_path == "src/old.tsx"
        assert request.dest_path == "src/new.tsx"


class TestGetCurrentUserId:
    """Tests for get_current_user_id function."""

    def test_get_current_user_id_success(self) -> None:
        """Test successful user ID extraction."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = "user-123"

        result = get_current_user_id(mock_request)
        assert result == "user-123"

    def test_get_current_user_id_missing(self) -> None:
        """Test exception when user ID is missing."""
        mock_request = MagicMock(spec=Request)
        mock_request.state = MagicMock(spec=[])

        with pytest.raises(HTTPException) as exc:
            get_current_user_id(mock_request)

        assert exc.value.status_code == 401

    def test_get_current_user_id_none(self) -> None:
        """Test exception when user ID is None."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = None

        with pytest.raises(HTTPException) as exc:
            get_current_user_id(mock_request)

        assert exc.value.status_code == 401


class TestValidateFilePath:
    """Tests for validate_file_path function."""

    def test_validate_file_path_simple(self) -> None:
        """Test simple valid path."""
        result = validate_file_path("src/app.tsx")
        assert result == "src/app.tsx"

    def test_validate_file_path_with_dots(self) -> None:
        """Test path with dots in filename."""
        result = validate_file_path("src/app.test.tsx")
        assert result == "src/app.test.tsx"

    def test_validate_file_path_normalized(self) -> None:
        """Test path normalization."""
        result = validate_file_path("src/./app.tsx")
        assert result == "src/app.tsx"

    def test_validate_file_path_traversal_rejected(self) -> None:
        """Test path traversal is rejected."""
        with pytest.raises(HTTPException) as exc:
            validate_file_path("../../../etc/passwd")

        assert exc.value.status_code == 400
        assert "path traversal" in exc.value.detail.lower()

    def test_validate_file_path_absolute_rejected(self) -> None:
        """Test absolute path is rejected."""
        with pytest.raises(HTTPException) as exc:
            validate_file_path("/etc/passwd")

        assert exc.value.status_code == 400
        assert "absolute" in exc.value.detail.lower()

    def test_validate_file_path_null_bytes_rejected(self) -> None:
        """Test null bytes are rejected."""
        with pytest.raises(HTTPException) as exc:
            validate_file_path("src/app\x00.tsx")

        assert exc.value.status_code == 400
        assert "null bytes" in exc.value.detail.lower()

    def test_validate_file_path_hidden_traversal_rejected(self) -> None:
        """Test hidden traversal attempts are rejected."""
        with pytest.raises(HTTPException) as exc:
            validate_file_path("src/../../../etc/passwd")

        assert exc.value.status_code == 400


class TestGetLanguageFromPath:
    """Tests for get_language_from_path function."""

    def test_typescript_tsx(self) -> None:
        """Test TypeScript TSX detection."""
        assert get_language_from_path("app.tsx") == "typescript"

    def test_typescript_ts(self) -> None:
        """Test TypeScript TS detection."""
        assert get_language_from_path("app.ts") == "typescript"

    def test_javascript_js(self) -> None:
        """Test JavaScript JS detection."""
        assert get_language_from_path("app.js") == "javascript"

    def test_javascript_jsx(self) -> None:
        """Test JavaScript JSX detection."""
        assert get_language_from_path("app.jsx") == "javascript"

    def test_python(self) -> None:
        """Test Python detection."""
        assert get_language_from_path("app.py") == "python"

    def test_json(self) -> None:
        """Test JSON detection."""
        assert get_language_from_path("package.json") == "json"

    def test_markdown(self) -> None:
        """Test Markdown detection."""
        assert get_language_from_path("README.md") == "markdown"

    def test_css(self) -> None:
        """Test CSS detection."""
        assert get_language_from_path("styles.css") == "css"

    def test_html(self) -> None:
        """Test HTML detection."""
        assert get_language_from_path("index.html") == "html"

    def test_yaml_yml(self) -> None:
        """Test YAML detection (.yml)."""
        assert get_language_from_path("config.yml") == "yaml"

    def test_yaml_yaml(self) -> None:
        """Test YAML detection (.yaml)."""
        assert get_language_from_path("config.yaml") == "yaml"

    def test_shell_sh(self) -> None:
        """Test Shell detection (.sh)."""
        assert get_language_from_path("script.sh") == "shell"

    def test_shell_bash(self) -> None:
        """Test Shell detection (.bash)."""
        assert get_language_from_path("script.bash") == "shell"

    def test_sql(self) -> None:
        """Test SQL detection."""
        assert get_language_from_path("query.sql") == "sql"

    def test_go(self) -> None:
        """Test Go detection."""
        assert get_language_from_path("main.go") == "go"

    def test_rust(self) -> None:
        """Test Rust detection."""
        assert get_language_from_path("main.rs") == "rust"

    def test_java(self) -> None:
        """Test Java detection."""
        assert get_language_from_path("Main.java") == "java"

    def test_c(self) -> None:
        """Test C detection."""
        assert get_language_from_path("main.c") == "c"

    def test_cpp(self) -> None:
        """Test C++ detection."""
        assert get_language_from_path("main.cpp") == "cpp"

    def test_c_header(self) -> None:
        """Test C header detection."""
        assert get_language_from_path("header.h") == "c"

    def test_cpp_header(self) -> None:
        """Test C++ header detection."""
        assert get_language_from_path("header.hpp") == "cpp"

    def test_unknown_extension(self) -> None:
        """Test unknown extension returns plaintext."""
        assert get_language_from_path("file.xyz") == "plaintext"

    def test_no_extension(self) -> None:
        """Test file without extension returns plaintext."""
        assert get_language_from_path("Makefile") == "plaintext"

    def test_case_insensitive(self) -> None:
        """Test extension detection is case insensitive."""
        assert get_language_from_path("app.PY") == "python"
        assert get_language_from_path("app.TSX") == "typescript"


class TestGetDemoFileTree:
    """Tests for get_demo_file_tree function."""

    def test_returns_list(self) -> None:
        """Test that get_demo_file_tree returns a list."""
        tree = get_demo_file_tree()
        assert isinstance(tree, list)

    def test_contains_src_directory(self) -> None:
        """Test that tree contains src directory."""
        tree = get_demo_file_tree()
        src_nodes = [n for n in tree if n.name == "src"]
        assert len(src_nodes) == 1
        assert src_nodes[0].type == "directory"

    def test_contains_package_json(self) -> None:
        """Test that tree contains package.json."""
        tree = get_demo_file_tree()
        package_nodes = [n for n in tree if n.name == "package.json"]
        assert len(package_nodes) == 1
        assert package_nodes[0].type == "file"

    def test_src_has_children(self) -> None:
        """Test that src directory has children."""
        tree = get_demo_file_tree()
        src_node = next(n for n in tree if n.name == "src")
        assert src_node.children is not None
        assert len(src_node.children) > 0

    def test_contains_components_directory(self) -> None:
        """Test that tree contains components directory."""
        tree = get_demo_file_tree()
        src_node = next(n for n in tree if n.name == "src")
        components = [c for c in src_node.children if c.name == "components"]
        assert len(components) == 1


class TestGetSessionListParams:
    """Tests for get_session_list_params dependency."""

    def test_default_params(self) -> None:
        """Test default parameter values."""
        params = get_session_list_params()
        assert params.page == 1
        assert params.page_size == 20
        assert params.include_archived is False
        assert params.archived_only is False
        assert params.status is None

    def test_custom_params(self) -> None:
        """Test custom parameter values."""
        params = get_session_list_params(
            page=3,
            page_size=50,
            include_archived=True,
            archived_only=False,
            status="active",
        )
        assert params.page == 3
        assert params.page_size == 50
        assert params.include_archived is True
        assert params.status == "active"


class TestDemoFileContents:
    """Tests for DEMO_FILE_CONTENTS constant."""

    def test_contains_expected_files(self) -> None:
        """Test that DEMO_FILE_CONTENTS contains expected files."""
        from src.routes.sessions import DEMO_FILE_CONTENTS

        assert "src/App.tsx" in DEMO_FILE_CONTENTS
        assert "src/index.tsx" in DEMO_FILE_CONTENTS
        assert "package.json" in DEMO_FILE_CONTENTS
        assert "README.md" in DEMO_FILE_CONTENTS

    def test_app_tsx_is_valid(self) -> None:
        """Test that App.tsx content is valid."""
        from src.routes.sessions import DEMO_FILE_CONTENTS

        content = DEMO_FILE_CONTENTS["src/App.tsx"]
        assert "function App" in content
        assert "useState" in content

    def test_package_json_is_valid_json(self) -> None:
        """Test that package.json is valid JSON."""
        import json

        from src.routes.sessions import DEMO_FILE_CONTENTS

        content = DEMO_FILE_CONTENTS["package.json"]
        data = json.loads(content)
        assert "name" in data
        assert "dependencies" in data
